import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

// Le premier lancement telecharge un binaire MongoDB : timeout genereux.
jest.setTimeout(120000);

let mongod: MongoMemoryServer | null = null;

export async function startDb() {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}

export async function clearDb() {
  const collections = Object.values(mongoose.connection.collections);
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
}

export async function stopDb() {
  await mongoose.disconnect();
  if (mongod) {
    await mongod.stop();
    mongod = null;
  }
}
