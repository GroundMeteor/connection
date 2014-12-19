Package.describe({
  name: 'ground:connection',
  version: '0.0.0',
  summery: 'Create a grounded connection'
});

Package.onUse(function(api) {
  api.versionsFrom('0.9.4');

  api.use([
    'underscore'
  ], 'client');

  api.addFiles([
    'connection.js',
  ], 'client');

  api.export('Ground');
});