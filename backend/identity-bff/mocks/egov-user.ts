import express from "express";
import type { DigitUser } from "../src/types.js";

interface StoredUser extends DigitUser {
  password: string;
}

export function createEgovUserMock() {
  const app = express();
  app.use(express.json());
  const users: Map<string, StoredUser> = new Map();
  let nextId = 1;

  const SYSTEM_TOKEN = "mock-system-token-12345";

  // POST /user/oauth/token (form-urlencoded)
  app.post(
    "/user/oauth/token",
    express.urlencoded({ extended: true }),
    (req, res) => {
      const { username } = req.body;
      // System user login
      if (username === "ADMIN" || username === "INTERNAL_MICROSERVICE_ROLE") {
        return res.json({
          access_token: SYSTEM_TOKEN,
          token_type: "bearer",
          expires_in: 604800,
          UserRequest: {
            uuid: "system-uuid",
            userName: username,
            name: "System",
            emailId: "",
            mobileNumber: "",
            tenantId: req.body.tenantId || "pg",
            type: "SYSTEM",
            roles: [{ code: "EMPLOYEE", name: "Employee" }],
          },
        });
      }
      // Regular user — find by userName
      const user = Array.from(users.values()).find(
        (u) => u.userName === username,
      );
      if (!user) return res.status(401).json({ error: "User not found" });
      res.json({
        access_token: `token-for-${user.uuid}`,
        token_type: "bearer",
        expires_in: 604800,
        UserRequest: { ...user, password: undefined },
      });
    },
  );

  // POST /user/_search
  app.post("/user/_search", (req, res) => {
    const { emailId, userName, tenantId } = req.body;
    const matches = Array.from(users.values()).filter((u) => {
      if (emailId && u.emailId !== emailId) return false;
      if (userName && u.userName !== userName) return false;
      // DIGIT stores users at root tenant — match root-to-root
      if (tenantId) {
        const searchRoot = tenantId.split(".")[0];
        const userRoot = u.tenantId.split(".")[0];
        if (searchRoot !== userRoot) return false;
      }
      return true;
    });
    res.json({ user: matches.map((u) => ({ ...u, password: undefined })) });
  });

  // POST /user/users/_createnovalidate
  app.post("/user/users/_createnovalidate", (req, res) => {
    const userData = req.body.user;
    const uuid = `uuid-${nextId++}`;
    const newUser: StoredUser = {
      uuid,
      userName: userData.userName || userData.emailId,
      name: userData.name,
      emailId: userData.emailId,
      mobileNumber: userData.mobileNumber || "9999900000",
      tenantId: userData.tenantId,
      type: userData.type || "CITIZEN",
      roles: userData.roles || [{ code: "CITIZEN", name: "Citizen" }],
      password: userData.password || "random",
    };
    users.set(uuid, newUser);
    res.json({ user: [{ ...newUser, password: undefined }] });
  });

  // POST /user/users/_updatenovalidate
  app.post("/user/users/_updatenovalidate", (req, res) => {
    const userData = req.body.user;
    const existing = users.get(userData.uuid);
    if (!existing) return res.status(404).json({ error: "User not found" });
    const updated = { ...existing, ...userData, password: existing.password };
    users.set(userData.uuid, updated);
    res.json({ user: [{ ...updated, password: undefined }] });
  });

  return { app, users, SYSTEM_TOKEN };
}
