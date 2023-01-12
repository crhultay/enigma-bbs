const { isString, isObject } = require('lodash');
const { v4: UUIDv4 } = require('uuid');
const {
    ActivityStreamsContext,
    messageBodyToHtml,
    selfUrl,
} = require('./activitypub_util');
const { Errors } = require('./enig_error');
const User = require('./user');
const Actor = require('./activitypub_actor');
const { getISOTimestampString } = require('./database');
const UserProps = require('./user_property');
const { postJson } = require('./http_util');

// deps
const async = require('async');
const _ = require('lodash');

module.exports = class Activity {
    constructor(obj) {
        this['@context'] = ActivityStreamsContext;
        Object.assign(this, obj);
    }

    static get ActivityTypes() {
        return [
            'Create',
            'Update',
            'Delete',
            'Follow',
            'Accept',
            'Reject',
            'Add',
            'Remove',
            'Like',
            'Announce',
            'Undo',
        ];
    }

    static fromJson(json) {
        const parsed = JSON.parse(json);
        return new Activity(parsed);
    }

    isValid() {
        if (
            this['@context'] !== ActivityStreamsContext ||
            !isString(this.id) ||
            !isString(this.actor) ||
            (!isString(this.object) && !isObject(this.object)) ||
            !Activity.ActivityTypes.includes(this.type)
        ) {
            return false;
        }

        //  :TODO: we could validate the particular types

        return true;
    }

    // https://www.w3.org/TR/activitypub/#accept-activity-inbox
    static makeAccept(webServer, localActor, followRequest, id = null) {
        id = id || Activity._makeId(webServer, '/accept');

        return new Activity({
            type: 'Accept',
            actor: localActor,
            object: followRequest, // previous request Activity
        });
    }

    static noteFromLocalMessage(webServer, message, cb) {
        const localUserId = message.getLocalFromUserId();
        if (!localUserId) {
            return cb(Errors.UnexpectedState('Invalid user ID for local user!'));
        }

        async.waterfall(
            [
                callback => {
                    return User.getUser(localUserId, callback);
                },
                (localUser, callback) => {
                    const remoteActorAccount = message.getRemoteToUser();
                    if (!remoteActorAccount) {
                        return callback(
                            Errors.UnexpectedState(
                                'Message does not contain a remote address'
                            )
                        );
                    }

                    const opts = {};
                    Actor.fromAccountName(
                        remoteActorAccount,
                        opts,
                        (err, remoteActor) => {
                            return callback(err, localUser, remoteActor);
                        }
                    );
                },
                (localUser, remoteActor, callback) => {
                    Actor.fromLocalUser(localUser, webServer, (err, localActor) => {
                        return callback(err, localUser, localActor, remoteActor);
                    });
                },
                (localUser, localActor, remoteActor, callback) => {
                    // we'll need the entire |activityId| as a linked reference later
                    const activityId = Activity._makeId(webServer, '/create');

                    // |remoteActor| is non-null if we fetchd it
                    //const to = message.isPrivate() ? remoteActor ? remoteActor.id : `${ActivityStreamsContext}#Public`;

                    // const obj = {
                    //     '@context': ActivityStreamsContext,
                    //     id: activityId,
                    //     type: 'Create',
                    //     to: [remoteActor.id],
                    //     audience: ['as:Public'],
                    //     actor: localActor.id,
                    //     object: {
                    //         id: Activity._makeId(webServer, '/note'),
                    //         type: 'Note',
                    //         attributedTo: localActor.id,
                    //         to: [remoteActor.id],
                    //         audience: ['as:Public'],
                    //         content: messageBodyToHtml(message.message.trim()),
                    //     },
                    // };

                    const obj = {
                        '@context': ActivityStreamsContext,
                        id: activityId,
                        type: 'Create',
                        actor: localActor.id,
                        object: {
                            id: Activity._makeId(webServer, '/note'),
                            type: 'Note',
                            published: getISOTimestampString(message.modTimestamp),
                            attributedTo: localActor.id,
                            // :TODO: inReplyto if this is a reply; we need this store in message meta.

                            //  :TODO: we may want to turn this to a HTML fragment?
                            content: messageBodyToHtml(message.message.trim()),
                        },
                    };

                    //  :TODO: this probably needs to change quite a bit based on "groups"
                    //  :TODO: verify we need both 'to' fields: https://socialhub.activitypub.rocks/t/problems-posting-to-mastodon-inbox/801/4
                    if (message.isPrivate()) {
                        obj.to = remoteActor.id;
                        obj.object.to = remoteActor.id;
                    } else {
                        const publicInbox = `${ActivityStreamsContext}#Public`;
                        obj.to = publicInbox;
                        obj.object.to = publicInbox;
                    }

                    const activity = new Activity(obj);
                    return callback(null, activity, localUser, remoteActor);
                },
            ],
            (err, activity, fromUser, remoteActor) => {
                return cb(err, { activity, fromUser, remoteActor });
            }
        );
    }

    sendTo(actorUrl, fromUser, webServer, cb) {
        const privateKey = fromUser.getProperty(UserProps.PrivateKeyMain);
        if (_.isEmpty(privateKey)) {
            return cb(
                Errors.MissingProperty(
                    `User "${fromUser.username}" is missing the '${UserProps.PrivateKeyMain}' property`
                )
            );
        }

        const reqOpts = {
            headers: {
                'Content-Type': 'application/activity+json',
            },
            sign: {
                //  :TODO: Make a helper for this
                key: privateKey,
                keyId: selfUrl(webServer, fromUser) + '#main-key',
                authorizationHeaderName: 'Signature',
                headers: ['(request-target)', 'host', 'date', 'digest', 'content-type'],
            },
        };

        const activityJson = JSON.stringify(this);
        return postJson(actorUrl, activityJson, reqOpts, cb);
    }

    static _makeId(webServer, prefix = '') {
        return webServer.buildUrl(`${prefix}/${UUIDv4()}`);
    }
};