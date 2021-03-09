#!/usr/bin/env node

const express = require('express')
var admin = require("firebase-admin");

const mqtt = require('./MQTT.js');
const S = require('./sessioncontroller');
const app = express()
const port = 1420;


var serviceAccount = require("./agroFireBaseAdmin.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://agromation-grow-room-control.firebaseio.com"
});

const db = admin.firestore();

//get a list of devices from firebase

let deviceSubs = {
    AgroOffice1: {
        live: {},
        dataHistory: {}
    },
}
let GlobalTopicSubscriptionList = {
    ///"AgroOffice1/data/Live": 1241516
}

let prevLiveData = {};
let prev30minHistory = {};

mqtt.createMqttClient().then((mqttClient) => {

    //middleware
    app.use(express.json());

    // app.use(function(req, res, next) {
    //     res.header("Access-Control-Allow-Origin", "https://us-central1-agromation-grow-room-control.cloudfunctions.net"); // update to match the domain you will make the request from
    //     res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    //     next();
    //   });

    //routes

    //api to test if server is up
    app.get('/ping', (req, res) => {
        res.set('Access-Control-Allow-Methods', '*');
        res.set('Access-Control-Allow-Headers', '*');
        res.send('DMZ-connector-ping \n ')
    })

    //this is called when the app logs in to smart grow This opens subscriptions to every deviceID and caches the historical data in deviceSubs
    app.post('/api/session', async (req, res) => {
        res.set('Access-Control-Allow-Methods', '*');
        res.set('Access-Control-Allow-Headers', '*');
        let { UID, deviceIDList } = req.body;
        //look for valid session in firebase
        if (!UID || !deviceIDList) {
            res.status(204).send("missing UID or DeviceIDList");
        }
        try {
            //get a list of sessions and order them by expiration date in descending order
            let checkSession = await db.collection("ClientSessions").where("ownerUID", '==', UID).orderBy('expTime', "desc").get()
            if (!checkSession.empty) {
                //check if the sessions are valid still.
                let index = 0;
                checkSession.forEach(async (doc) => {
                    index++;
                    //of the first document exists check if the session is expired.
                    if (doc.exists && index < 2) {
                        let { expTime } = doc.data();
                        let now = Math.floor(Date.now() / 1000);
                        console.log(index);
                        //check if session is expired already
                        if (now > expTime) {
                            //create a new session since the last one expired
                            console.log('session expired creating new session')
                            try {
                                let session = await S.createNewSession(db, UID, deviceIDList);
                                console.log(session)
                                //here we are going to add the new topics to the subscriptions
                                let topicUpdater = S.updateTopics(GlobalTopicSubscriptionList, session.topics, session.expTime);
                                try {
                                    //add the subscriptions 
                                    let granted = await mqtt.createSub(mqttClient, topicUpdater.newSubs);

                                    console.log("successfully subscribed")
                                    res.send({ sessionID: doc.id, granted: granted });
                                } catch (err) {
                                    //this is an MQTT error
                                    console.log(err)
                                    res.status(500).send(err)
                                }

                            } catch (err) {
                                //error creating new session
                                console.log(err)
                                res.status(500).send(err)
                            }

                        } else {
                            console.log('update session exp time') 
                            // update the session exp time 
                            try {

                                let updatedExpirationSession = await S.updateSession(db, doc.id, doc.data().expTime);
                                // console.log(topics)
                                //update the local expiration times. returns object with new subs and globalTopic object.
                                let topicUpdater = S.updateTopics(GlobalTopicSubscriptionList, updatedExpirationSession.topics, updatedExpirationSession.expTime);
                                GlobalTopicSubscriptionList = topicUpdater.newGlobalTopicsObject;
                                console.log(GlobalTopicSubscriptionList);
                                //check if there are new Topics to subscribe too. Ensure newSubs has more then 0 subscriptions otherwise cant create new subs.
                                if(topicUpdater.newSubs && topicUpdater.newSubs.length>0){
                                    try {
                                        //add the subscriptions //new subs is undefined because there are no new topics to sub
                                        let granted = await mqtt.createSub(mqttClient, topicUpdater.newSubs);
    
                                        res.send({ sessionID: doc.id, granted: granted });
                                    } catch (err) {
                                        //this is an MQTT error
                                        console.log(err)
                                        res.status(500).send(err)
                                    }
                                }else{
                                    //there are new topics just updating the exp times.
                                    res.send({ sessionID: doc.id, granted: updatedExpirationSession.topics });
                                }
                                
                            } catch (err) {
                                //this is an error updating session
                                console.log(err)
                                res.status(500).send(err)
                            }
                        }
                        index++;
                    }
                    index++;

                })

            } else {
                //create a new session here since none exist
                try {
                    //create a new session
                    let session = await S.createNewSession(db, UID, deviceIDList);
                    //create a new topic updater based on the new information
                    console.log(session)
                    let topicUpdater = S.updateTopics(GlobalTopicSubscriptionList, session.topics, session.expTime);
                    try {
                        //add the subscriptions 
                        let granted = await mqtt.createSub(mqttClient, topicUpdater.newSubs);
                        console.log("successfully subscribed")
                        res.send({ sessionID: session.id, granted: granted });
                    } catch (err) {
                        //this is an MQTT error
                        console.log(err)
                        res.status(500).send(err)
                    }
                    //here we are going to add the new topics to the subscriptions

                } catch (err) {
                    //this is an error making a new session
                    console.log(err)
                    res.status(500).send(err)
                }
            }
        } catch (err) {
            //this is are error checking the session
            console.log(err);
            res.status(500).send(err);
        }
    })

    //closes the session and stops the subscriptions. 
    //for now we will just let sessions expire
    app.post('/api/sessionEnd', async (req, res) => {
        let { UID } = req.body;
        // get the device list for that UID session
        // for each device listed unsubscribe.

    })


    // Express app initialization.
    app.listen(port, () => {
        console.log(`Example app listening at http://localhost:${port}`)
    })
    //mqtt message handler
    mqtt.clientMsgHandler(mqttClient, (msg) => {
        //parse the topic and upload to the correct firebase document
        let topicParts = msg.topic.split('/')
        //update firestore with the new data.
        switch (topicParts[2]) {
            case "Live":
                //upload live data to
                let LiveDataRef = db.collection("Rooms").doc(topicParts[0]).collection("Live").doc('LiveData');
                let output = {
                    temp: msg.msg.main.temp,
                    rh: msg.msg.main.humidity,
                    co2: msg.msg.main.pressure + Math.floor(Math.random() * 2000),
                    vpd: msg.msg.main.pressure,
                }

                if (msg.msg !== prevLiveData) {
                    console.log('updating live data');
                    prevLiveData = msg.msg;
                    S.updateLiveData(db, LiveDataRef, output);
                }
                break;
            case "History":
                //upload history object
                let min30Ref = db.collection("Rooms").doc(topicParts[0]).collection('History').doc("30Min");
                if (msg.msg !== prev30minHistory) {
                    console.log('updating history in db');
                    S.updateHistory(db, min30Ref, msg.msg);
                    prev30minHistory = msg.msg;
                }
                break;
        }

        if (GlobalTopicSubscriptionList[msg.topic] < Math.floor(Date.now() / 1000)) {
            console.log('removing expired sub')
            mqtt.removeSubs(mqttClient, msg.topic)
        }
        console.log(msg);
    })

}).catch((err) => {
    console.log(err);
});

