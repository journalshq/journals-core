import {codec} from "lisk-sdk";
import {eventsSchema} from "../schemas";

const CHAIN_STATE_EVENTS = 'journals:events'

export const getAllEvents = async (stateStore) => {
    const registeredEventsBuffer = await stateStore.chain.get(CHAIN_STATE_EVENTS);
    if (!registeredEventsBuffer) {
        return [];
    }

    const decodedEvents = codec.decode(
        eventsSchema,
        registeredEventsBuffer
    );

    // @ts-ignore
    return decodedEvents.events;
};

export const setEvents = async (stateStore, events) => {

    const sortedEvents = {
        events: events.sort((a, b) => a.id.compare(b.id)),
    };

    await stateStore.chain.set(
        CHAIN_STATE_EVENTS,
        codec.encode(eventsSchema, sortedEvents)
    );
};