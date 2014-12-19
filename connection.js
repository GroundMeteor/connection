Ground = { };

var prototypeMethods = ['_anyMethodsAreOutstanding',
'_callOnReconnectAndSendAppropriateOutstandingMethods',
'_getServerDoc',
'_livedata_connected',
'_livedata_data',
'_livedata_error',
'_livedata_nosub',
'_livedata_result',
'_lostConnection',
'_maybeMigrate',
'_outstandingMethodFinished',
'_processOneDataMessage',
'_process_added',
'_process_changed',
'_process_nosub',
'_process_ready',
'_process_removed',
'_process_updated',
'_pushUpdate',
'_readyToMigrate',
'_retrieveAndStoreOriginals',
'_runAfterUpdateCallbacks',
'_runWhenAllServerDocsAreFlushed',
'_saveOriginals',
'_send',
'_sendOutstandingMethods',
'_subscribeAndWait',
'_unsubscribeAll',
'_waitingForQuiescence',
'apply',
'call',
'close',
'constructor',
'disconnect',
'methods',
'reconnect',
'registerStore',
'setUserId',
'status',
'subscribe',
'userId'];


// Uniq storage name
var localName = '__groundConnection_subs';

var indent = function(count) {
  return '............................................'.substring(0, count);
};

var currentSubLoading = 0;

var subscriptions = [];
var lookupSubscriptions = {};

// Default is empty data subscriptions
var dataSubscriptions = {};

try {
  // Data string
  var dataString = localStorage.getItem(localName);

  // Try to load the data subscriptions from local storage
  if (dataString)
    dataSubscriptions = JSON.parse(dataString);

}catch(err){

  // Start from scratch
  // dataSubscriptions = {};

}

// We have to know what stores we are supporting offline
var registeredStores = {};

Ground.subscriptions = subscriptions;
Ground.dataSubscriptions = dataSubscriptions;
Ground.lookupSubscriptions = lookupSubscriptions;

// Data buffer being loaded...
var loadedData = [];

var resumedData = {};

var interceptors = {

  'registerStore': function(name) {
    console.log('#### registerStore', name);
    registeredStores[name] = true;
  },

  '_livedata_data': function(msg) {

      if (msg.msg == 'added' && registeredStores[msg.collection]) {
        // XXX: Conflict resolution should go on here... We should also remove
        // __createdAt and __updatedAt before putting it in the user collection

        // Data added to a subscription
        loadedData.push(msg);
      }

      // Track live data in subscriptions
      if (msg.msg == 'ready' && loadedData.length) {

        // XXX: Should we hinder this?
        if (msg.subs.length > 1)
          throw new Error('Not sure we can ground this connection due to multiple subscription ready`s');

        // Grap the loaded data
        var buffer = loadedData;

        // Reset loaded data
        loadedData = [];

        // Get the first id
        var id = msg.subs[0];

        // Get the subscription details
        var currentSub = this._onlineConnection._subscriptions[id];

        // Create id args array
        var idArgs = _.toArray(currentSub.params);

        // Add the name as first argument
        idArgs.unshift(currentSub.name);

        // Generate the identifier for a subscription
        var id = JSON.stringify(idArgs);

        // Make sure the sub data is ready
        dataSubscriptions[id] = dataSubscriptions[id] || {};

        // Now work on the loaded data
        _.each(buffer, function(data) {

          // Set collection
          dataSubscriptions[id][data.collection] = dataSubscriptions[id][data.collection] || {};
          // Set the data
          dataSubscriptions[id][data.collection][data.id] = data.fields;

        });

        // Store this subscription in the local storage
        try {
          // XXX: Use localStorage while prototyping, in the future use
          // ground:store
          localStorage.setItem(localName, JSON.stringify(dataSubscriptions));
          console.log('## Stored', id, 'subscription');
        }catch(err) {
          console.log('## Could not store', id, 'subscription', err);
        }

      }

  },

  '_send': function(msg) {

      if (msg.msg == 'pong') debug = false;
      if (msg.msg == 'sub') console.log('### subscribe', msg.id, msg.name, msg.params);
      if (msg.msg == 'unsub') console.log('### unsubscribe', msg.id);

      // Store the sub
      if (msg.msg == 'sub') {
        // XXX: Change this making it only subscribe to new data? but what if
        // the user removed data from the collection via the server... we
        // cant track down stuff like this if the user does the actual removal
        lookupSubscriptions[msg.id] = subscriptions.push(msg) - 1;
      }

      if (msg.msg == 'connect') {
        currentSubLoading = 0;
        subscriptions = [];
        lookupSubscriptions = {}; 
        Ground.subscriptions = subscriptions;
        Ground.lookupSubscriptions = lookupSubscriptions;          
      }

  },

  'subscribe': function(name /*, args, [callback] */) {
    var self = this;

    // Helper, get the last argument
    var lastArg = arguments[arguments.length-1];
    // If function convert to unified object
    lastArg = (typeof lastArg == 'function')? { onReady: lastArg } : lastArg;
    // Is last arg a callback?
    var lastArgIsCallback = (lastArg && typeof (lastArg.onReady || lastArg.onError) == 'function');
    // Store arguments as array
    var idArgs = _.toArray(arguments);
    // Pop the last argument if its a callback
    if (lastArgIsCallback) idArgs.pop();
    // Helper for the subscription id in the cache
    var id = JSON.stringify(idArgs);

    if (typeof dataSubscriptions[id] !== 'undefined' && typeof resumedData[id] == 'undefined') {
      // Make sure we only resume once
      resumedData[id] = true;
      // Load this subscription from cache... :)
      _.each(dataSubscriptions[id], function(data, col) {
        // From this subscription we get the data and collection name
        _.each(data, function(doc, _id) {

          var msg = {
            collection: col,
            fields: doc,
            id: _id,
            msg: 'added'
          };
          console.log('------ LOAD LOCAL SUB DATA', name, col, data, msg);
          self._onlineConnection._livedata_data.apply(self._onlineConnection, [msg]);

        });
      });
    }
  }
};



Ground.connection = function(ConnectionOrUrl) {
  var self = this;
  
  // Make sure to use new
  if (!(self instanceof Ground.connection))
    return new Ground.connection(ConnectionOrUrl);

  self._onlineConnection = Meteor.connection;

  if (ConnectionOrUrl) {
    // The user want this to be different
    if (ConnectionOrUrl === ''+ConnectionOrUrl) {
      // Guess the user entered an url
      self._onlineConnection = new Meteor.connect(ConnectionOrUrl);
    } else if (ConnectionOrUrl instanceof Meteor.connection) {
      // Guess the user handed in a connection
      self._onlineConnection = ConnectionOrUrl;
    } else {
      // We dont support this input
      throw new Error('Ground.connection got invalid argument');
    }
  }

  if (typeof self._onlineConnection === 'undefined')
    throw new Error('Ground connection could not create connection');

  self.indent = 0;

  self.super = {};

  _.each(prototypeMethods, function(name) {

    // Remember the super
    self.super[name] = self._onlineConnection[name];

    self._onlineConnection[name] = function(/* arguments */) {

      var debug = true;

      //if (name == 'subscribe') console.log('### subscribe', arguments);

      // verbose printout
      debug && console.log(indent(self.indent), 'CALL', name, ':', arguments);
      self.indent++;

      // Add interceptors
      if (interceptors[name]) interceptors[name].apply(self, _.toArray(arguments));

      // call super
      var result = self.super[name].apply(self._onlineConnection, _.toArray(arguments));

      self.indent--;
      debug && console.log(indent(self.indent), 'RESULT', name, ':', result);

      return result;
    }
  });

  // Return the manhandled connection 
  return this._onlineConnection;
};

// _afterUpdateCallbacks: Array[0]
// _documentsWrittenByStub: Object
// _heartbeat: Heartbeat
// _heartbeatIntervalHandle:
// _heartbeatTimeoutHandle: null
// _onTimeout: function () {
// _sendPing: function () {

//  heartbeatInterval: 35000
//  heartbeatTimeout: 15000
//  __proto__: Heartbeat
//  _heartbeatInterval: 35000
//  _heartbeatTimeout: 15000
//  _lastSessionId: "jE22qhh5K3jXeWx6X"
//  _messagesBufferedUntilQuiescence: Array[0]
//  _methodHandlers: Object
//  _methodInvokers: Object
//  _methodsBlockingQuiescence: Object
//  _nextMethodId: 1
//  _outstandingMethodBlocks: Array[0]
//  _resetStores: false
//  _retryMigrate: null
//  _serverDocuments: Object
//  _stores: Object
//  _stream: LivedataTest.ClientStream
//  _subsBeingRevived: Object
//  _subscriptions: Object
//  _supportedDDPVersions: Array[3]
//  _updatesForUnknownStores: Object
//  _userId: null
//  _userIdDeps: Tracker.Dependency
//  _version: "1"
//  _versionSuggestion: "1"
//  onReconnect: null


////////////////////////////////////////////////////////////////////////////////
////             PROTOTYPE                                                   ///
////////////////////////////////////////////////////////////////////////////////


