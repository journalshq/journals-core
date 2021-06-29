import { transactions } from 'lisk-sdk';
import { supportedEventStateSchema, subscriptionStateSchema } from '../schemas/treasury';
import {
	CHAIN_STATE_SUBSCRIPTIONS,
	CHAIN_STATE_SUPPORTED_EVENTS,
	TREASURY_ADDRESS,
	TREASURY_BLOCK_WINDOW_SIZE,
} from '../constants';
import { NewsEvent, Subscription, SupportedEvent } from '../typings';
import { getChainStateByDataAccess } from '../utils/chain.utils';
import { BaseModuleDataAccess } from 'lisk-framework/dist-node/types';
import { findEvents } from './events';
import * as R from 'remeda';
import { SubscriptionDTO } from './dto/SubscriptionDTO';

export const getSubscriptions = async (dataAccess: BaseModuleDataAccess, address: string) => {
	const { subscriptions = [] } = await getChainStateByDataAccess(
		dataAccess,
		CHAIN_STATE_SUBSCRIPTIONS,
		subscriptionStateSchema,
	);
	return subscriptions
		.filter((item: Subscription) => Buffer.from(item?.address).toString('hex') === address)
		.map(item => new SubscriptionDTO(item.id, item));
};

export const hasActiveSubscription = async (dataAccess: BaseModuleDataAccess, address: string) => {
	const [{ subscriptions = [] }, { height }] = await Promise.all([
		getChainStateByDataAccess(dataAccess, CHAIN_STATE_SUBSCRIPTIONS, subscriptionStateSchema),
		dataAccess.getLastBlockHeader(),
	]);
	const activeSubscription = subscriptions.find(
		(item: Subscription) =>
			Buffer.from(item?.address).toString('hex') === address && item.expiresAt > height,
	);
	return !!activeSubscription;
};

export const hasSupportedEvent = async (
	dataAccess: BaseModuleDataAccess,
	address: string,
	eventId: string,
) => {
	const { supportedEvents = [] } = await getChainStateByDataAccess(
		dataAccess,
		CHAIN_STATE_SUPPORTED_EVENTS,
		supportedEventStateSchema,
	);
	if (supportedEvents?.length === 0) return false;

	const support = supportedEvents.find(
		(item: SupportedEvent) =>
			Buffer.from(item?.address).toString('hex') === address && eventId == item.eventId,
	);
	return !!support;
};

export const getSupportedEvents = async (
	dataAccess: BaseModuleDataAccess,
): Promise<SupportedEvent[]> => {
	const response = await getChainStateByDataAccess(
		dataAccess,
		CHAIN_STATE_SUPPORTED_EVENTS,
		supportedEventStateSchema,
	);
	return (response.supportedEvents || []) as SupportedEvent[];
};

export const getSupportedEventsByAddress = async (
	dataAccess: BaseModuleDataAccess,
	address: string,
): Promise<SupportedEvent[]> => {
	const response = await getChainStateByDataAccess(
		dataAccess,
		CHAIN_STATE_SUPPORTED_EVENTS,
		supportedEventStateSchema,
	);
	const supportedEvents = (response.supportedEvents || []) as SupportedEvent[];
	const addressBuffer = Buffer.from(address, 'hex');
	return supportedEvents.filter(item => Buffer.compare(item.address, addressBuffer) === 0);
};

export const getSupportersCountByEventId = async (
	dataAccess: BaseModuleDataAccess,
	eventId: string,
) => {
	const supportedEvents = await getSupportedEvents(dataAccess);
	return supportedEvents?.filter(event => event?.eventId === eventId)?.length || 0;
};

export const getSnapshotByRound = async (dataAccess: BaseModuleDataAccess) => {
	let account;
	let holdings = BigInt(0);

	try {
		account = await dataAccess.getAccountByAddress(Buffer.from(TREASURY_ADDRESS, 'hex'));
		if (account) {
			holdings = BigInt(account?.token?.balance);
		}
	} catch (e) {}

	const [supportedEvents, blockHeader] = await Promise.all([
		getSupportedEvents(dataAccess),
		dataAccess.getLastBlockHeader(),
	]);

	const eventIds = supportedEvents.map(item => item.eventId);
	const events = await findEvents(dataAccess);

	// { [eventId]: number }
	const eventSupportersMap = getEventSupportersMap(events, eventIds);

	// { [eventId]: BigInt }
	const funding = getQuadraticFunding(
		Number(transactions.convertBeddowsToLSK(`${account?.token?.balance || 0}`)),
		eventSupportersMap,
	);

	return {
		round: Math.round(blockHeader.height / TREASURY_BLOCK_WINDOW_SIZE) + 1,
		holdings: holdings.toString(),
		subscriptionCount: supportedEvents?.length || 0,
		events: events.map(event => ({
			...event,
			supporters: eventSupportersMap[event.id],
			funding: funding[event.id].toString(),
		})),
	};
};

const getEventSupportersCount = (eventId: string, eventIds: string[]): number =>
	R.countBy(eventIds, id => id === eventId);

const getEventSupportersMap = (events: NewsEvent[], eventIds: string[]): Record<string, number> =>
	R.flatMapToObj(events, event => [
		[String(event.id), getEventSupportersCount(event.id, eventIds)],
	]);

const getQuadraticFunding = (
	totalAmount: number,
	eventSupportCount: Record<string, number>,
): Record<string, number> => {
	let summed = 0; // Setup summed grant contributions
	let result = {};
	if (totalAmount === 0) {
		return R.mapValues(eventSupportCount, () => 0);
	}

	Object.keys(eventSupportCount).forEach(eventId => {
		const arr = Array(eventSupportCount[eventId]).fill(Math.sqrt(1));
		let sumAmount = arr.reduce((a, b) => a + b, 0);
		// Square the total value of each summed grants contributions
		sumAmount *= sumAmount;
		result[eventId] = sumAmount;
		summed += sumAmount;
	});
	// Setup a divisor based on available match
	let divisor = summed !== 0 ? totalAmount / summed : 0;
	// Multiply matched values with divisor to get match amount in range of available funds
	Object.keys(eventSupportCount).forEach(eventId => {
		result[eventId] *= divisor;
	});

	return result;
};
