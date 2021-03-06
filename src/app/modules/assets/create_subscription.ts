import { ApplyAssetContext, BaseAsset, codec } from 'lisk-sdk';
import {
	CHAIN_STATE_SUBSCRIPTIONS,
	SUBSCRIBE_ASSET_ID,
	SUBSCRIPTION_PERIOD_IN_BLOCKS,
	SUBSCRIPTION_FEE,
	TREASURY_ADDRESS,
} from '../constants';
import { createSubscriptionSchema, subscriptionStateSchema } from '../schemas/treasury';
import { getChainStateByStateStore } from '../utils/chain.utils';

interface CreateSubscriptionAssetContext {
	amount: number;
}

export class Create_subscription extends BaseAsset {
	id = SUBSCRIBE_ASSET_ID;
	name = 'subscribe';
	schema = createSubscriptionSchema;

	async apply({
		transaction,
		stateStore,
		reducerHandler,
		asset,
	}: ApplyAssetContext<CreateSubscriptionAssetContext>): Promise<void> {
		const transactionHash = (transaction.id as Buffer).toString('hex');
		const sender = await stateStore.account.get(transaction.senderAddress);
		const currentHeight = stateStore.chain.lastBlockHeaders[0].height;

		const currentRound = Math.floor(currentHeight / SUBSCRIPTION_PERIOD_IN_BLOCKS);
		const subscription = {
			id: transactionHash,
			address: sender.address,
			startsAt: currentHeight,
			expiresAt: (currentRound + asset.amount) * SUBSCRIPTION_PERIOD_IN_BLOCKS,
		};

		const { subscriptions = [] } = await getChainStateByStateStore(
			stateStore,
			CHAIN_STATE_SUBSCRIPTIONS,
			subscriptionStateSchema,
		);

		subscriptions.push(subscription);
		const sortedSubscriptions = subscriptions.sort((a, b) => a.startsAt < b.startsAt);

		await stateStore.chain.set(
			CHAIN_STATE_SUBSCRIPTIONS,
			codec.encode(subscriptionStateSchema, { subscriptions: sortedSubscriptions }),
		);

		const accountBalance = await reducerHandler.invoke<bigint>('token:getBalance', {
			address: sender.address,
		});

		const minRemainingBalance = await reducerHandler.invoke<bigint>('token:getMinRemainingBalance');

		const subtractableBalance =
			accountBalance - minRemainingBalance > BigInt(0)
				? accountBalance - minRemainingBalance
				: BigInt(0);

		if (subtractableBalance > BigInt(0)) {
			const subscriptionCost = BigInt(SUBSCRIPTION_FEE * asset.amount);
			await reducerHandler.invoke('token:debit', {
				address: transaction.senderAddress,
				amount: subscriptionCost,
			});
			await reducerHandler.invoke('token:credit', {
				address: Buffer.from(TREASURY_ADDRESS, 'hex'),
				amount: subscriptionCost,
			});
		}
	}
}
