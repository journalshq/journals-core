import {BaseAsset} from "lisk-sdk";
import {CREATE_EVENT_ASSET_ID} from "../constants";
import {createEventSchema} from "../schemas";
import {getAllEvents, setEvents} from "./helpers";

export class CreateEventAsset extends BaseAsset {
    id = CREATE_EVENT_ASSET_ID;
    name = 'createEvent';
    schema = createEventSchema;

    async apply({
              asset,
              transaction,
              stateStore,
          }): Promise<void> {
        const sender = await stateStore.account.get(transaction.senderAddress);

        const event = {
            id: asset.id,
            name: asset.name,
            description: asset.description,
            createdBy: sender.address
        }

        const events = await getAllEvents(stateStore);
        events.push(event);
        await setEvents(stateStore, events);
    }



}
