/** Local PGR integration fixture: actual BFF routes + production providers, HTTP KC/DIGIT fixtures. */
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { config } from '../../../../identity-bff/src/infrastructure/config.ts';
import { initCache, closeCache, getRedis } from '../../../../identity-bff/src/infrastructure/redis.ts';
import { createKcAdminMock } from '../../../../identity-bff/mocks/kc-admin.ts';
import { createFakeDigitUser } from '../../../../identity-bff/mocks/fake-digit-user.ts';
import { onboardingDependencies } from '../../../../identity-bff/src/modules/onboarding/production.ts';
import { onboardingAuthorization, registerOnboardingRoutes } from '../../../../identity-bff/src/modules/onboarding/routes.ts';
import { readBindings } from '../../../../identity-bff/src/modules/bindings/store.ts';
const require = createRequire(new URL('../../../../identity-bff/package.json', import.meta.url));
const express = require('express');
const servers: any[] = [];
async function listen(app: any) { const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); servers.push(server);return `http://127.0.0.1:${server.address().port}`; }
const kc = await listen(createKcAdminMock().app);
const tenants: string[] = [];
const digit = createFakeDigitUser({ tenants });
const digitBase = await digit.start();
const prefix = `pgr-recovery-${randomUUID()}`;
Object.assign(config, { keycloakAdminUrl: kc, keycloakOrganizationRealm: `pgr-${randomUUID()}`, cachePrefix: prefix,
  digitUserServiceUrl: `${digitBase}/user`, digitMdmsSearchUrl: `${digitBase}/mdms-v2/v1/_search`,
  digitAdminUsername: 'PGR-TEST-ADMIN', digitAdminPassword: 'FixtureOnly1!', digitAdminTenantId: 'pg', identityOnboardingToken: 'pgr-fixture-token' });
digit.addAccount({ userName: 'PGR-TEST-ADMIN', name: 'Admin', tenantId: 'pg', type: 'EMPLOYEE', active: true, mobileNumber: '9876543210', emailId: null, identificationMark: null,
  roles: [{ code: 'SUPERUSER', tenantId: 'pg' }, { code: 'ACCOUNT_ADMIN', tenantId: 'pg' }], password: 'FixtureOnly1!' });
initCache('redis://127.0.0.1:16382');await getRedis().ping();
const app = express();app.use(express.json());
app.use('/internal/identity/v1', (req:any,res:any,next:any) => { if(onboardingAuthorization(req,res)===true)next(); });
registerOnboardingRoutes(app, onboardingDependencies);
app.post('/__fixture/person', async (req:any,res:any) => {
  const tenant = req.body.tenantId;tenants.push(tenant);
  const subject = randomUUID();
  const result = await fetch(`${kc}/admin/realms/${config.keycloakOrganizationRealm}/users`, { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:subject,username:subject,email:`${subject}@example.test`,emailVerified:true,enabled:true}) });
  if(result.status!==201)return res.status(500).json({code:'FIXTURE_PERSON_FAILED'});
  const account = digit.addAccount({ userName: randomUUID(), name:'Founder',tenantId:tenant,type:'EMPLOYEE',active:true,mobileNumber:'9876543211',emailId:'founder@example.test',identificationMark:null,
    roles:[{code:'ACCOUNT_ADMIN',tenantId:tenant},{code:'SUPERUSER',tenantId:tenant}],password:'FounderFixture1!' });
  res.json({subject,uuid:account.uuid});
});
app.post('/__fixture/collision',async (req:any,res:any)=>{
  await fetch(`${kc}/__test/faults`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({method:'POST',path:'/organizations',status:409,count:req.body.count??1})});res.json({ok:true});
});
app.post('/__fixture/state',async (req:any,res:any)=>{
  const organizations=await (await fetch(`${kc}/admin/realms/${config.keycloakOrganizationRealm}/organizations?briefRepresentation=false&max=100`)).json();
  res.json({organizations,bindings:await readBindings(req.body.subject)});
});
const base=await listen(app);
writeFileSync(process.argv[2],JSON.stringify({base}));
async function stop(){
  // Delete only this fixture's keys, never flush the shared lane database.
  let cursor='0';do{const result=await getRedis().scan(cursor,'MATCH',`${prefix}:*`,'COUNT',200);cursor=result[0];if(result[1].length)await getRedis().del(...result[1]);}while(cursor!=='0');
  await closeCache();await digit.stop();for(const server of servers)await new Promise(resolve=>server.close(resolve));process.exit(0);
}
process.on('SIGTERM',()=>void stop());process.on('SIGINT',()=>void stop());
