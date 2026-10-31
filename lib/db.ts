import mongoose from "mongoose";

type MongooseCache = { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null };
const globalForMongoose = globalThis as typeof globalThis & { mongooseCache?: MongooseCache };
const cache = globalForMongoose.mongooseCache ?? { conn: null, promise: null };
globalForMongoose.mongooseCache = cache;

export async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not configured. Copy .env.example to .env.local and add your MongoDB Atlas connection string.");
  }
  if (cache.conn) return cache.conn;
  if (!cache.promise) {
    cache.promise = mongoose.connect(uri, {
      bufferCommands: false,
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
    });
  }
  try {
    cache.conn = await cache.promise;
  } catch (error) {
    cache.promise = null;
    throw error;
  }
  await dropLegacyIndexes(cache.conn);
  return cache.conn;
}

let legacyIndexesChecked = false;

/** Older deployments had a unique (assignmentId, meetingType) index that blocks several clarification meetings per task. */
async function dropLegacyIndexes(connection: typeof mongoose) {
  if (legacyIndexesChecked) return;
  legacyIndexesChecked = true;
  try {
    const collection = connection.connection.collection("meetings");
    const indexes = await collection.indexes();
    if (indexes.some((index) => index.name === "assignmentId_1_meetingType_1")) {
      await collection.dropIndex("assignmentId_1_meetingType_1");
    }
  } catch {
    // The collection may not exist yet; nothing to migrate.
  }
}
