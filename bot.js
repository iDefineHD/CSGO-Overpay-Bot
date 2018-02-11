/*
	Initalizing packages
*/
const SteamUser = require('steam-user');
const TradeOfferManager = require('steam-tradeoffer-manager');
const SteamTotp = require('steam-totp');
const SteamCommunity = require('steamcommunity');
const fs = require('fs');
const request = require('request');
const config = require('./config.json');

const community = new SteamCommunity();
const client = new SteamUser();
const manager = new TradeOfferManager({

    steam: client,
    domain: 'example.com',
    language: 'en'
});

/*
	Polling Steam and Logging On
*/
client.logOn({
    accountName: config.username,
    password: config.password,
    twoFactorCode: SteamTotp.generateAuthCode(config.sharedSecret)
});

/*
	Getting prices
*/
const priceUrl = 'https://api.csgofast.com/price/all';

function getPriceList() {
    request(priceUrl, (error, response, body) => {
        if (error || response.statusCode !== 200) return console.log(`Error: ${error} - Status Code: ${response.statusCode}`);
        fs.writeFile('prices.json', body);
    });
}

function priceItemsInOffer(offer) {
    let offerValue = 0;
    if (offer) {
        const prices = require('./prices.json'); //Requiring price file
        //Loop through offer and get total price
        for (var x in offer) {
            prices[offer[x].market_hash_name] >= config.options.minPricePerItem ? offerValue += prices[offer[x].market_hash_name] : null;
        }
    }
    return offerValue;
}

//Make the first price request
getPriceList();
//Auto Refresh price
setInterval(getPriceList, config.options.priceRefreshInterval * 1000);

/*
	Friend requests and chat
*/
client.on('friendRelationship', (steamID, relationship) => {
    if (relationship === 2 && config.options.acceptRandomFriendRequests) {
        client.addFriend(steamID);
        client.chatMessage(steamID, config.options.chatResponse.newFriend);
    }
});

client.on('friendMessage', (steamID, message) => {
    console.log(config.options.chatResponse.commands[message]);
    if (config.options.chatResponse.commands[message]) {
        client.chatMessage(steamID, config.options.chatResponse.commands[message]);
    } else {
        client.chatMessage(steamID, config.options.chatResponse.unknownCommand);
    }
});

/*
	Offer handling
*/
function isInArray(value, array) {
    return array.indexOf(value) > -1;
}

function acceptOffer(offer) {
    offer.accept((err) => {
        if (err) console.log(`Unable to accept offer: ${err.message}`);
        community.checkConfirmations();
    });
}

function declineOffer(offer) {
    offer.decline((err) => {
        if (err) return console.log(`Unable to decline offer: ${err.message}`);
    });
}

manager.on('newOffer', function(offer) {
    const partnerID = offer.partner.getSteamID64();

    offer.getUserDetails((err, me, them) => {
        if (err) return console.log(err);

        if (them.escrowDays > 0) {
            console.log('Trade is in escrow. Declining.');
            declineOffer(offer);
        }
    });

    console.log(`New offer # ${offer.id} from ${partnerID}`);

    if (isInArray(partnerID, config.adminIDs)) {
        client.chatMessage(partnerID, config.options.chatResponse.adminTrade);
        acceptOffer(offer);

    } else if (!offer.itemsToGive.length) {
        console.log(`${partnerID} just donated us items.`);

        client.chatMessage(partnerID, config.options.chatResponse.donation); //Sending message for donations
        acceptOffer(offer);

    } else if (priceItemsInOffer(offer.itemsToReceive) < config.options.minimumprice) {
        client.chatMessage(partnerID, config.options.chatResponse.junk); //Sending message for donations
        declineOffer(offer);

    } else if (priceItemsInOffer(offer.itemsToGive) > priceItemsInOffer(offer.itemsToReceive) * config.options.percentamount) {
        client.chatMessage(partnerID, config.options.chatResponse.tradeDeclined); //Sending message when trade declined
        declineOffer(offer);
    } else {
        client.chatMessage(partnerID, config.options.chatResponse.tradeAccepted); //Sending message for accepting offer
        acceptOffer(offer);
    }
});



//Refresh polldata.json
manager.on('pollData', function(pollData) {
    fs.writeFile('polldata.json', JSON.stringify(pollData));
});

if (fs.existsSync('polldata.json')) {
    manager.pollData = JSON.parse(fs.readFileSync('polldata.json'));
}

client.on('loggedOn', function(details) {
    console.log(`Logged into Steam as ${client.steamID.getSteam3RenderedID()}`);
    client.setPersona(SteamUser.Steam.EPersonaState.Online, config.botname);
    client.gamesPlayed([730])
});

client.on('webSession', function(sessionID, cookies) {
    manager.setCookies(cookies, function(err) {
        if (err) return console.log(err);
        console.log(`Got API key: ${manager.apiKey}`);
    });

    community.setCookies(cookies);
    community.startConfirmationChecker(config.options.confirmationInterval, config.identitySecret);
});
