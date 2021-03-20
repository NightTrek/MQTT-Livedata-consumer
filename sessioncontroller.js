const expirationInterval = 5 * 60;


const createNewSession = async (db, UID, deviceList) => {
    return new Promise(async (resolve, reject) => {
        if (!db) {
            reject({ error: 'Firebase DB undefined' });
        };
        if (!UID || typeof UID !== 'string') {
            reject({ error: 'UID undefined' });
        };
        if (!deviceList || !deviceList[0] || typeof deviceList[0] !== 'string') {
            reject({ error: 'DeviceList is invalid' });
        };
        let topicList = [];
        deviceList.forEach((item, index) => {
            topicList.push(item + "/data/Live")
            topicList.push(item + "/data/History")
        })

        let output = {
            createdTime: Math.floor(Date.now() / 1000),
            expTime: Math.floor(Date.now() / 1000) + expirationInterval,
            ownerUID: UID,
            topics: topicList
        }
        try {
            let newClientSession = await db.collection('ClientSessions').add(output)
            if (newClientSession) {
                output.id = newClientSession.id
                resolve(output);
            }
        } catch (err) {
            console.log(err)
            reject(err)
        }

    })

}

const updateSession = async (db, clientSessionID, prevExpTime) => {
    return new Promise(async (resolve, reject) => {
        if (!db) {
            reject({ error: 'Firebase DB undefined' });
        };
        if (!clientSessionID || typeof clientSessionID !== 'string') {
            reject({ error: 'UID undefined' });
        };
        if (!prevExpTime) {
            reject({ error: 'prevExpTime undefined' });
        }

        let sessionRef = db.collection('ClientSessions').doc(clientSessionID);
        db.runTransaction((transaction) => {
            return transaction.get(sessionRef).then((SessionDoc) => {
                if (!SessionDoc.exists) {
                    throw new Error("Document does not exist")
                }
                let data = SessionDoc.data();
                if (data.expTime >= prevExpTime + expirationInterval) {
                    return data
                }
                else {
                    data.expTime = prevExpTime + expirationInterval;
                    transaction.update(sessionRef, data);
                    data.doc = SessionDoc.id;
                    return data;
                }
            }).then((output) => {
                resolve(output)

            }).catch((err) => {
                console.log(err);
                reject(err)
            })
        })
        ///END OF update Transaction

    })

}

//takes a topic object and adds or updates the topic object with new expTimes and new topics
const updateTopics = (GlobalTopicsList, oldSessionTopics, newDeviceIDList, expTime) => {
    if(!GlobalTopicsList || !oldSessionTopics || !newDeviceIDList || !expTime){
        return new Error("session controller Error: updateTopics missing one of its input arguments")
    }
    let output = GlobalTopicsList;
    let expiredOrNewTopics = [];
    //check if there are new topics that arent in the old Session
    if(oldSessionTopics.length < newDeviceIDList.length*2){
        //create old session topics object to reference
        let DeviceIdObject = {};
       oldSessionTopics.forEach((topic) => {
           let deviceIDAndTopicArray = topic.split('/');
            DeviceIdObject[deviceIDAndTopicArray[0]]=true;
       })
       console.log(DeviceIdObject);
        newDeviceIDList.forEach((item) => {  
            //if the device ID is not in the deviceID object add Live and History to oldSessionTopics
            if(!DeviceIdObject[item]){
                oldSessionTopics.push(item + "/data/Live");
                oldSessionTopics.push(item + "/data/History");
            }
        })
    }

    //this function loops through each existing topic and updates the GlobalTopiclist and adds items to newTopicsList
    oldSessionTopics.forEach((item) => {
        //here we check to see if the topic is expired and there for does not already have a subscription and will need to be subscribed
        // if the original topics is undefined its automatically added to sub list
        if(!GlobalTopicsList[item] || GlobalTopicsList[item] < Math.floor(Date.now() / 1000) ){
            expiredOrNewTopics.push(item);
        }
        output[item] = expTime;
        
    });
    // console.log(expiredTopics);
    return {
        newSubs:expiredOrNewTopics,
        newGlobalTopicsObject:output
    };
}


const updateLiveData = async (db, docRef, input) => {
    // console.log('updating live data')
    return new Promise((resolve, reject) => {
        if(!docRef || !input || !input.temp || !input.co2 || !input.vpd || !input.rh){
            throw new Error("missing inputs or docRef");
        }
        db.runTransaction((transaction) => {
            return transaction.get(docRef).then((liveDataDoc) => {
                if (!liveDataDoc.exists) {
                    throw new Error("Document does not exist")
                }
                let data = liveDataDoc.data();
                if(data.temp == input.temp && data.rh == input.rh && data.co2 == input.co2 && data.vpd == input.vpd ){
                    console.log('no need to update live data')
                    return data;
                }else{
                    transaction.update(docRef, input);
                }
         
            }).then((output) => {
                resolve(output)
    
            }).catch((err) => {
                console.log(err);
                reject(err)
            })
        })
    })  
}

const updateHistory = async (db, docRef, input) => {
    return new Promise((resolve, reject) => {
        if(!docRef || !input ){
            throw new Error("missing inputs or docRef");
        }
        db.runTransaction((transaction) => {
            return transaction.get(docRef).then((min30HistoryDoc) => {
                if (!min30HistoryDoc.exists) {
                    throw new Error("Document does not exist")
                }
                let data = min30HistoryDoc.data();
                if(data.data == input.data){
                    return data;
                }else{
                    transaction.update(docRef, input);
                }
         
            }).then((output) => {
                resolve(output)
    
            }).catch((err) => {
                console.log(err);
                reject(err)
            })
        })
    })

}


const AddAlarms = async (docRef, input) => {
    return new Promise((resolve, reject) => {
        if(!docRef || !input ){
            throw new Error("missing inputs or docRef");
        }
        docRef.set(input).then((item) => {
            if(item.id){
                resolve(item.id);
            }else{
                reject(item)
            }
        }).catch((err) => {
            resolve(err)
        })
       
    })

}

module.exports = {
    createNewSession: createNewSession,
    updateSession:updateSession,
    updateTopics:updateTopics,
    updateLiveData:updateLiveData,
    updateHistory:updateHistory,
    AddAlarms:AddAlarms
}