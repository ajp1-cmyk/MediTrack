#!/usr/bin/env node
// Starts a MongoDB server for local development on 127.0.0.1:27017 with no
// system installation: it uses the `mongod` binary that mongodb-memory-server
// downloads and caches inside node_modules.
//
//   npm run db:local
//
// Data is stored in backend/.mongo-data so it survives restarts (it is also
// git-ignored). Leave this running in one terminal and start the backend with
// `npm run dev` in another.
const path = require('path');
const fs = require('fs');
const { MongoMemoryServer } = require('mongodb-memory-server');

const PORT = Number(process.env.LOCAL_MONGO_PORT || 27017);
const DB_PATH = path.join(__dirname, '..', '.mongo-data');

async function main() {
  fs.mkdirSync(DB_PATH, { recursive: true });

  const server = await MongoMemoryServer.create({
    instance: { port: PORT, dbPath: DB_PATH, storageEngine: 'wiredTiger' },
  });

  console.log(`✅ local MongoDB listening on ${server.getUri()}`);
  console.log(`   data  : ${path.relative(process.cwd(), DB_PATH)}/`);
  console.log('   uri   : mongodb://127.0.0.1:27017/meditrack  (use this as MONGODB_URI)');
  console.log('   stop  : Ctrl+C\n');

  const stop = async () => {
    console.log('\nStopping local MongoDB…');
    await server.stop({ doCleanup: false }); // keep the data directory
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => {
  console.error(`❌ Could not start a local MongoDB: ${err.message}`);
  process.exit(1);
});
