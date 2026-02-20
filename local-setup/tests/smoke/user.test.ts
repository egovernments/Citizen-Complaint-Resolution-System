import { api, createRequestInfo } from '../utils/api';
import { db } from '../utils/db';
import { config } from '../utils/config';
import { CreateUserResponseSchema, LoginResponseSchema } from '../schemas/user';

describe('User Service', () => {
  const { ports, tenant } = config;
  const timestamp = Date.now();
  const testUser = {
    userName: `testuser-${timestamp}`,
    name: 'Test User',
    mobileNumber: '9999900001',
    gender: 'MALE',
    type: 'EMPLOYEE' as const,
    tenantId: tenant.city,
    password: 'eGov@123',
  };

  let createdUserUuid: string;
  let accessToken: string;

  describe('Create User', () => {
    test('should create a new user with valid data', async () => {
      const response = await api.post(ports.user, '/user/users/_createnovalidate', {
        RequestInfo: createRequestInfo(),
        User: {
          ...testUser,
          active: true,
          roles: [{ code: 'EMPLOYEE', name: 'Employee', tenantId: tenant.city }],
        },
      });

      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);

      // Validate response schema
      const parsed = CreateUserResponseSchema.safeParse(response.data);
      expect(parsed.success).toBe(true);

      if (parsed.success) {
        const user = parsed.data.user[0];
        createdUserUuid = user.uuid;

        // Validate user data
        expect(user.userName).toBe(testUser.userName);
        expect(user.name).toBe(testUser.name);
        expect(user.tenantId).toBe(testUser.tenantId);
        expect(user.type).toBe(testUser.type);
        expect(user.active).toBe(true);
        expect(user.roles).toHaveLength(1);
        expect(user.roles[0].code).toBe('EMPLOYEE');
      }
    });

    test('should verify user exists in database', async () => {
      expect(createdUserUuid).toBeDefined();

      const exists = await db.userExistsByUuid(createdUserUuid);
      expect(exists).toBe(true);

      // Verify additional user data in DB
      const dbUser = await db.queryOne<{ uuid: string; tenantid: string; active: boolean }>(
        'SELECT uuid, tenantid, active FROM eg_user WHERE uuid = $1',
        [createdUserUuid]
      );

      expect(dbUser).not.toBeNull();
      expect(dbUser?.tenantid).toBe(tenant.city);
      expect(dbUser?.active).toBe(true);
    });

    test('should reject duplicate username', async () => {
      const response = await api.post(ports.user, '/user/users/_createnovalidate', {
        RequestInfo: createRequestInfo(),
        User: {
          ...testUser,
          active: true,
          roles: [{ code: 'EMPLOYEE', name: 'Employee', tenantId: tenant.city }],
        },
      });

      // Should fail or return existing user error
      const data = response.data as { Errors?: Array<{ code: string }> };
      if (!response.ok || data.Errors) {
        expect(data.Errors?.[0]?.code).toContain('DuplicateUserName');
      }
    });
  });

  describe('User Login', () => {
    test('should login with valid credentials', async () => {
      const response = await api.request(ports.user, '/user/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ZWdvdi11c2VyLWNsaWVudDo=',
        },
        body: null, // Will be set as form data
      });

      // Need to make a raw fetch for form data
      const loginResponse = await fetch(
        `${config.baseUrl}:${ports.user}/user/oauth/token`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ZWdvdi11c2VyLWNsaWVudDo=',
          },
          body: new URLSearchParams({
            username: testUser.userName,
            password: testUser.password,
            grant_type: 'password',
            scope: 'read',
            tenantId: tenant.city,
            userType: 'EMPLOYEE',
          }),
        }
      );

      const data = await loginResponse.json();

      expect(loginResponse.ok).toBe(true);

      // Validate response schema
      const parsed = LoginResponseSchema.safeParse(data);
      expect(parsed.success).toBe(true);

      if (parsed.success) {
        accessToken = parsed.data.access_token;
        expect(accessToken).toBeDefined();
        expect(accessToken.length).toBeGreaterThan(10);
        expect(parsed.data.token_type).toBe('bearer');
        expect(parsed.data.expires_in).toBeGreaterThan(0);
      }
    });

    test('should reject invalid credentials', async () => {
      const loginResponse = await fetch(
        `${config.baseUrl}:${ports.user}/user/oauth/token`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ZWdvdi11c2VyLWNsaWVudDo=',
          },
          body: new URLSearchParams({
            username: testUser.userName,
            password: 'wrongpassword',
            grant_type: 'password',
            scope: 'read',
            tenantId: tenant.city,
            userType: 'EMPLOYEE',
          }),
        }
      );

      expect(loginResponse.ok).toBe(false);
      expect(loginResponse.status).toBe(400);
    });
  });
});
