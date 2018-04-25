// @flow

import { getInviteURL } from '../base/connection';
import { inviteVideoRooms } from '../videosipgw';

import {
    UPDATE_DIAL_IN_NUMBERS_FAILED,
    UPDATE_DIAL_IN_NUMBERS_SUCCESS
} from './actionTypes';
import {
    getDialInConferenceID,
    getDialInNumbers,
    invitePeopleAndChatRooms,
    invitePhoneNumbers
} from './functions';

const logger = require('jitsi-meet-logger').getLogger(__filename);

/**
 * Sends AJAX requests for dial-in numbers and conference ID.
 *
 * @returns {Function}
 */
export function updateDialInNumbers() {
    return (dispatch: Dispatch<*>, getState: Function) => {
        const state = getState();
        const { dialInConfCodeUrl, dialInNumbersUrl, hosts }
            = state['features/base/config'];
        const mucURL = hosts && hosts.muc;

        if (!dialInConfCodeUrl || !dialInNumbersUrl || !mucURL) {
            // URLs for fetching dial in numbers not defined
            return;
        }

        const { room } = state['features/base/conference'];

        Promise.all([
            getDialInNumbers(dialInNumbersUrl),
            getDialInConferenceID(dialInConfCodeUrl, room, mucURL)
        ])
            .then(([ dialInNumbers, { conference, id, message } ]) => {
                if (!conference || !id) {
                    return Promise.reject(message);
                }

                dispatch({
                    type: UPDATE_DIAL_IN_NUMBERS_SUCCESS,
                    conferenceID: id,
                    dialInNumbers
                });
            })
            .catch(error => {
                dispatch({
                    type: UPDATE_DIAL_IN_NUMBERS_FAILED,
                    error
                });
            });
    };
}

/**
 * Invite people to the conference.
 *
 * @param {Array} inviteItems - Information about the invitees.
 * @returns {Promise}
 */
export function sendInvitesForItems(inviteItems: Array<Object>) {
    return (
            dispatch: Dispatch<*>,
            getState: Function): Promise<Array<Object>> => {
        let allInvitePromises = [];
        let invitesLeftToSend = [
            ...inviteItems
        ];
        const state = getState();
        const { conference } = state['features/base/conference'];
        const { inviteServiceUrl } = state['features/base/config'];
        const inviteUrl = getInviteURL(state);
        const jwt = state['features/base/jwt'].jwt;

        // First create all promises for dialing out.
        if (conference) {
            const phoneInvites = invitePhoneNumbers(inviteItems, conference);

            const phoneInvitePromises
                = phoneInvites.map(({ number, promise }) =>
                    promise.then(() => {
                        invitesLeftToSend
                            = invitesLeftToSend.filter(currentInvite =>
                                currentInvite !== number);
                    })
                    .catch(error => logger.error(
                        'Error inviting phone number:', error)));

            allInvitePromises = allInvitePromises.concat(phoneInvitePromises);
        }

        const usersAndRooms = invitesLeftToSend.filter(i =>
            i.item.type === 'user' || i.item.type === 'room')
            .map(i => i.item);

        if (usersAndRooms.length) {
            // Send a request to invite all the rooms and users. On success,
            // filter all rooms and users from {@link invitesLeftToSend}.
            const peopleInvitePromise = invitePeopleAndChatRooms(
                inviteServiceUrl,
                inviteUrl,
                jwt,
                usersAndRooms)
                .then(() => {
                    invitesLeftToSend = invitesLeftToSend.filter(i =>
                        i.item.type !== 'user' && i.item.type !== 'room');
                })
                .catch(error => logger.error(
                    'Error inviting people:', error));

            allInvitePromises.push(peopleInvitePromise);
        }

        // Sipgw calls are fire and forget. Invite them to the conference
        // then immediately remove them from {@link invitesLeftToSend}.
        const vrooms = invitesLeftToSend.filter(i =>
            i.item.type === 'videosipgw')
            .map(i => i.item);

        conference
            && vrooms.length > 0
            && dispatch(inviteVideoRooms(conference, vrooms));

        invitesLeftToSend = invitesLeftToSend.filter(i =>
            i.item.type !== 'videosipgw');

        return (
            Promise.all(allInvitePromises)
                .then(() => invitesLeftToSend)
        );
    };
}
