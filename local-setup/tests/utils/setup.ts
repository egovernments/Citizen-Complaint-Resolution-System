import { db } from './db';

// Increase timeout for all tests
jest.setTimeout(30000);

// Connect to database before tests
beforeAll(async () => {
  db.connect();
});

// Close database connection after all tests
afterAll(async () => {
  await db.close();
});
