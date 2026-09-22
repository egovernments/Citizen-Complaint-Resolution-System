# The xstate-chatbot module, top to bottom

A guide to the current architecture. It starts at the outermost boundary — a
WhatsApp message arriving over HTTP — and works inward to the individual guard
conditions that decide where a conversation goes next.

Parts 1–11 cover what you need to read or change a conversation. Parts 12–15
explain how the machine is built underneath, and can wait until a state path
confuses you. Budget 30–40 minutes for the whole thing.

Paths are relative to `backend/xstate-chatbot/nodejs/`.

---

## Contents


**Orientation**

1. [What this module is](#part-1--what-this-module-is)
2. [The path of a single message](#part-2--the-path-of-a-single-message)
3. [Why a state machine](#part-3--why-a-state-machine)

**Authoring a conversation**

4. [The machine from the top](#part-4--the-machine-from-the-top)
5. [How a flow is written](#part-5--how-a-flow-is-written)
6. [What each state class does](#part-6--what-each-state-class-does)
7. [The filing journey](#part-7--the-filing-journey)

**Data through the flow**

8. [Slots: the answer bag](#part-8--slots-the-answer-bag)
9. [Text and translation](#part-9--text-and-translation)
10. [Understanding what the citizen typed](#part-10--understanding-what-the-citizen-typed)
11. [The tree walks](#part-11--the-tree-walks)

**Under the hood**

12. [XState v4, from zero](#part-12--xstate-v4-from-zero)
13. [Keys, ids and nesting](#part-13--keys-ids-and-nesting)
14. [The compiler](#part-14--the-compiler)
15. [The triplet: the core idiom](#part-15--the-triplet-the-core-idiom)

**Runtime**

16. [The session layer](#part-16--the-session-layer)
17. [Saving and resuming a conversation](#part-17--saving-and-resuming-a-conversation)
18. [Channels](#part-18--channels)
19. [The backend services](#part-19--the-backend-services)

**Operating it**

20. [Tenants](#part-20--tenants)
21. [Configuration](#part-21--configuration)
22. [What fails at boot, and why that is good](#part-22--what-fails-at-boot-and-why-that-is-good)
23. [Tests](#part-23--tests)
24. [Deleted dead code](#part-24--deleted-dead-code)

**Working in it**

25. [Recipes](#part-25--recipes)
26. [Gotchas worth knowing in advance](#part-26--gotchas-worth-knowing-in-advance)

---

## Part 1 — What this module is



This is a conversational front end for filing citizen grievances. A citizen sends
WhatsApp messages; the bot replies with numbered menus; at the end a complaint row
exists in the PGR backend exactly as if it had been filed through the web portal.
It is one service among many in a DIGIT deployment, and it owns no data of its own
beyond where each conversation has got to.

Everything the bot knows comes from other services. Complaint categories come from
MDMS, geographic areas from the boundary service, translated text from the
localisation service, the citizen's identity from the user service, attachments
from filestore, and the finished complaint goes to `pgr-services`. The bot is
orchestration and dialogue; it is emphatically not a system of record.

The module is a small Express application. `src/app.js` builds the server, mounts
one router, and listens on `SERVICE_PORT` (default `8082`) under `CONTEXT_PATH`
(default `/xstate-chatbot`). Anything outside that path gets a 404. It does not
listen until two gates pass: `assertRequiredConfigOrExit()` and
`loadLocalisationOrExit()`, both described in Part 22.

There is one exception to the 404, and it is worth knowing it exists before you
meet it. `DEV_PROXY_ENABLED=true` replaces the fallback with a catch-all proxy onto
the DIGIT services host, so the local dialog harness can call DIGIT APIs
same-origin. On anything publicly reachable that turns the container into an open
proxy onto internal APIs — and the Twilio webhook requires the container to be
publicly reachable. It is off by default and logs a warning when it is not.

```js
// src/app.js - the entire server
const app = express();
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true, parameterLimit: 50000 }));
app.use(envVariables.contextPath, require('./channel/routes'));   // /xstate-chatbot/*

if (envVariables.devProxyEnabled) {                               // local development only
  app.use(createProxyMiddleware('/', { target: envVariables.egovServices.egovServicesHost }));
} else {
  app.use((req, res) => res.sendStatus(404));                     // not ours
}

warnAtStartup();
assertRequiredConfigOrExit();                                     // refuses to boot on missing credentials
loadLocalisationOrExit().then(() => app.listen(port));
```

There is no build step and no TypeScript. It is plain CommonJS JavaScript on Node,
with `require` and `module.exports`, and `npm test` runs the suite through Node's
own test runner. The dependencies that matter: Express with `express-rate-limit`,
`xstate` 4.38.3, `node-fetch` and Axios, `dotenv`, `moment-timezone`, `uuid`,
`kafka-node` for telemetry, `exifr` for stripping image metadata, and a Postgres
driver. No framework layer sits between you and the code, and nothing is generated
at build time. What you read is what runs.

The single most important thing to understand before opening any file: **the bot
holds no conversation in memory between messages.** Each inbound WhatsApp message
is a separate HTTP request, possibly served by a different process. Where the
citizen "is" in the conversation is data, loaded and saved every turn. Almost
everything else in this document follows from that one fact.

---

## Part 2 — The path of a single message



A citizen types "1" and presses send. WhatsApp delivers it to Twilio, Twilio POSTs
a form-encoded body to a public URL, and that URL routes to
`src/channel/routes/index.js`, `POST /message`. This is the module's only real
entry point for conversation, and every feature described here is ultimately
triggered from it. Everything after that route is internal and unaware HTTP exists.

Two pieces of middleware run before the handler. `verifySignature` asks the active
channel adapter whether it can vouch for the request and answers 403 if it cannot,
so an unsigned body never reaches a parser or a session. The rate limiter then keys
on the signed sender rather than on the IP — behind an ingress every request shares
one address, and `X-Forwarded-For` is caller-controlled, so an IP key would be both
useless and forgeable.

The handler itself builds an `InboundRequestParser` around the request and the
adapter, resolves the upload tenant only when sandbox mode is on, and asks
`hasValidMessage()`. If there is one, `getRequestModel()` produces it and
`sessionManager.authenticateAndDispatch` takes it — deliberately without being
awaited, with a `.catch` handing failures to `error-handler.js`, which answers the
citizen rather than logging into the void.

```js
// src/channel/routes/index.js - the conversation entry point
router.post("/message", verifySignature, webhookLimiter, async (req, res) => {
  try {
    const inboundRequestParser = InboundRequestParser.create(req, channelProvider);

    if (config.isSandboxMode) {                            // only sandbox needs this
      inboundRequestParser.setTenatId(await resolveUploadTenantId(req, config));
    }

    if (await inboundRequestParser.hasValidMessage()) {    // false = not a user message
      const inboundRequestModel = await inboundRequestParser.getRequestModel();
      sessionManager
        .authenticateAndDispatch(inboundRequestModel)      // deliberately NOT awaited
        .catch((error) => handleError(error, inboundRequestModel));
    }
  } catch (e) {
    console.log(e);
  } finally {
    res.end();                                             // always answer the webhook
  }
});
```

Not awaiting is deliberate. The webhook provider retries when a response is slow,
and a retry would deliver the citizen's message twice. So the route answers at once
and attaches a `.catch` so a failure is logged rather than becoming a silent
unhandled rejection. `res.end()` sits in a `finally`, so the provider always gets
an answer even if the handler throws.

The parser's job is narrow: hand the request to the channel adapter and return what
comes back. The adapter and the upload tenant are both passed in rather than
imported, so parsing knows nothing about session state or user identity. A `null`
result is a normal outcome meaning "this was not a user message", such as a
delivery receipt.

What the adapter returns is the *reformatted message*, the neutral shape everything
downstream speaks. It carries `user` (mobile number, later a userId and locale),
`message` (`{ type, input }` where type is `text`, `image`, `document`, `location`
or `button`), and `extraInfo` (the tenant, the business number the citizen wrote to,
and similar envelope data).

`sessionManager.authenticateAndDispatch` in `src/session/session-manager.js` runs
the turn. It wraps the raw payload in an `InboundRequestModel`, picks a login flow
based on whether sandbox mode is on, and asks that flow to resolve a session. If the
flow returns nothing it has already replied to the citizen itself, and the turn ends
there.

With a session in hand it calls `chatService.dispatch`. That rotates the session id
if the citizen has been idle, logs telemetry, loads or creates the stored
conversation state, builds a running machine from it, and sends exactly one event —
`USER_RESET` if the message was a greeting, otherwise `USER_MESSAGE`. Sending that
event is the whole turn.

Outbound text travels the reverse path. Machine code calls
`dialog.sendMessage(context, text)`, which appends to `context.output` and, when told
to flush, calls `context.chatInterface.toUser(...)`. `chatInterface` is the session
manager itself, placed into context when the conversation starts — that is how
machine code reaches the outside world without importing anything, and why the
context is not pure data.

Note the batching. `sendMessage(context, text, false)` accumulates without sending,
and the next flushing send delivers everything queued. This is how a retry notice
and the re-asked question arrive as one WhatsApp delivery instead of two, which
matters because two deliveries can arrive out of order. When you see `false` as the
third argument, that is what it means.

```js
// src/machine/util/dialog.js - the third argument is the flush flag
dialog.sendMessage(context, retryText, false);   // queue only, nothing goes out
dialog.sendMessage(context, questionText);       // immediate: flushes BOTH as one delivery
```

---

## Part 3 — Why a state machine



Consider filing a complaint: pick a category, pick a sub-category, name the
institution, describe the problem, optionally attach a photo, pick a city, pick a
ward, accept two consent statements, choose confidentiality. Nine questions, each
with retries, each with a "go back", each needing its answer remembered until the
end when the complaint is finally assembled and posted.

Written as ordinary code this becomes a tangle of flags. Where are we? What did they
already answer? Is this "2" a menu choice or a rejection? And because each message
is a fresh HTTP request, you cannot use a call stack or a loop — the function that
asked the question returned long before the answer arrived.

A state machine solves exactly this. The conversation position is one value. The
rules for what each input means are attached to that position rather than scattered
across conditionals. Serialising the position is trivial, which is what makes the
stateless-request problem disappear. And the set of reachable positions is
enumerable, so the whole dialogue can be reasoned about.

The library is XState, and it is worth being blunt about the version: this is XState
**4**, and the XState 5 documentation you will find by searching does not apply.
There are no `@xstate/*` companion packages, no `setup()`, no actors. The idioms
here are v4 idioms and some look dated. They are correct for 4.38.3.

```js
// package.json allows any v4; there are no @xstate/* companions
"xstate": "^4.13.0"        // package-lock.json resolves it to 4.38.3

// and this is the only Machine() call in the module:
//   src/machine/state-machine.js  ->  const stateMachine = Machine(config);
```

---

## Part 4 — The machine from the top



Three small files assemble the machine, and reading them in order takes a few
minutes. `shell-machine.js` builds onboarding and the chassis: the start gate,
welcome, language menu, end state, system error, the not-authorized notice, and a
placeholder node named `pgr`. It ends by calling `compile()` with its top-level
states and the key it starts at. `pgr-machine.js` builds complaint filing the same
way. Neither file knows about the other, so you can read either one on its own and
understand the journey it describes.

`citizen-service-machine.js` joins them. It spreads the shell's config, then
replaces the placeholder `pgr` entry with the filing config, producing one tree.
It also declares two root-level handlers. `USER_RESET` fires when the citizen
sends a greeting or restart word, and `USER_CANCEL` when they send a cancel word.
Both are declared at the root so they work from any state, which is the escape
hatch that keeps a citizen from getting stuck. Both check the whitelist first, so
a reset word cannot be used to walk past the gate.

```js
// src/machine/citizen-service-machine.js - the whole assembly
const config = {
  id: 'citizenService',
  on: {
    USER_RESET: [
      { target: '#notAuthorized', cond: (context) => !shell.isWhitelisted(context) },
      { target: '#welcome' }
    ],
    USER_CANCEL: [
      { target: '#notAuthorized', cond: (context) => !shell.isWhitelisted(context) },
      { target: '#cancelSession' }
    ]
  },
  ...shell.config,
  states: { ...shell.config.states, pgr: pgr.config }
};
```

`state-machine.js` is fourteen lines: it takes that config and calls `Machine()`.
The session layer imports this file and nothing deeper, so the whole flow is
swappable behind one export. If you are tracing a bug from the outside in, this is
the order to read: `state-machine.js` tells you where the config comes from,
`citizen-service-machine.js` tells you how the two journeys fit together, and the
two machine files tell you what each step does.

## Part 5 — How a flow is written



A flow is a list of state objects. Each object is one step in the conversation:
it knows its own key, the message it sends when entered, and which state comes
next. You build the list in plain JavaScript, then hand it to `compile()`, which
turns it into the XState config the machine runs. Only `compile()` and the state
classes know XState exists. Everything you write when adding a question, a menu
or a service call is ordinary object construction, so you can read a flow
top to bottom without knowing the state-chart library underneath.

> Snippets from here on show compiled output containing XState terms such as
> `assign`, `always` and `entry`. You do not need them to author a flow. Part 12
> explains them from zero when you want to read what a state becomes.

Every state inherits from `State` in `flow/flow-state.js` and is configured
through fluent setters, each returning the object so calls chain. `setPrompt`
sets the message sent on entry. `setNext(state)` says where to go afterwards,
and takes the **state object**, not its name — a typo is a crash at startup
rather than a dead end discovered in production. `setConditionalNext(state, cond)`
adds a guarded branch; chain as many as you need and close with an unguarded
`setNext`. Guards are tried in order, so the first match wins.

Six classes cover the kinds of step a conversation needs:

| Class | Use it when |
|---|---|
| `State` | you only need to send a message and move on |
| `QuestionState` | you show a fixed list of options and match the reply |
| `AskState` | you accept free input, validate it, and store it |
| `ProcessingState` | you call a backend service and branch on success or failure |
| `WalkState` | you walk a tree one level at a time, such as an MDMS hierarchy |
| `GateState` | you branch immediately on context, sending no message |

Each class adds setters for its own job. `AskState` has `setAccept` (the input
type it will take), `setValidate`, `setOnValid` and `setRetryMessage`.
`ProcessingState` has `setProcessing` for the async call plus `setOnError`.
`WalkState` has `setFetch` for one level of the tree, and three outcomes —
`setOnLeaf`, `setOnEmpty`, `setOnError` — so the flow reacts to what the tree
actually returned. The setters are the whole contract: if a behaviour is not
reachable through them, it belongs in a new class rather than a special case.

```js
// src/machine/pgr-machine.js - a question, an answer, and where each goes
const consent = new QuestionState('consent');
const description = new AskState('description');

consent
  .setPrompt(messages.fileComplaint.consent.question)
  .setOptions(['Yes', 'No'])
  .setConditionalNext(consentDeclined, (context) => context.consent === 'No')
  .setNext(description);
```

`Group` nests states under a shared parent. You give it a key, `setStates` with
the list, and `setStart` with the key it begins at; `setOnEntry` runs a
context-mutating function each time the group is entered, which is how scratch
answers get cleared on re-entry. A group compiles to a compound node carrying its
key as an XState `id`, so other states can target it absolutely with `#key`.
That is how a step deep inside the filing journey jumps to a shared chassis state
such as `#endstate` without knowing where it sits in the tree.

The journeys themselves live in two files. `shell-machine.js` holds onboarding
and the chassis — welcome, language menu, cancel, end, error. `pgr-machine.js`
holds complaint filing. `citizen-service-machine.js` splices the filing config
into the shell's `pgr` slot so both run as one machine, and `state-machine.js`
wraps that for the session layer. To add a step you construct a state in the
right file, wire it with `setNext`, and add it to the list passed to `compile()`.
Nothing else needs to change.

## Part 6 — What each state class does



`State` is the base. On entry it sends its prompt, if it has one, then immediately
resolves its branches and moves on. It never waits for the citizen. Use it for
anything read but not answered: the welcome, the thank-you, the notice shown when
consent is declined. If you want to send a message from inside a transition, add a
`State` instead — the flow stays readable when every message the citizen sees has
a state of its own.

`QuestionState` sends a prompt, waits for a reply, and matches it against options.
Options come from `setOptions`, either a fixed array or a function of context when
the list depends on data. An unrecognised reply sends the retry message and asks
again, unless `setOnUnknown` routes it elsewhere. `AskState` handles free input
instead: `setAccept` declares the input type, `setValidate` checks it, `setOnValid`
writes it into context, and an invalid answer triggers the retry message. Both
loop on the same state rather than advancing, so a bad answer never skips a step.

`ProcessingState` calls a backend service. `setProcessing` supplies a function
returning a promise; resolution follows the normal branches, rejection follows
`setOnError`. It sends no prompt and waits for nothing, so it is the right place
for every network call — keeping them out of the states that talk to the citizen.
`setOutcomeMessage` sends a message that depends on the result, such as a
complaint number returned by the create call.

`WalkState` walks a tree one level at a time and is what makes the hierarchy
menus work. `setFetch` receives the path chosen so far and returns that level's
options plus whether it is a leaf. Three outcomes cover what the tree can do:
`setOnLeaf` when the citizen reaches the bottom, `setOnEmpty` when a level has no
options, `setOnError` when the fetch fails. `setTrail` shows the chosen path above
the menu and `setPreamble` adds text before it. Depth is never hardcoded, so the
same state serves a three-level and a five-level hierarchy.

`GateState` branches on context without sending anything, which the start step
uses to decide between onboarding and the main menu. `Group` nests states under a
shared parent, described in Part 5.

## Part 7 — The filing journey



`pgr-machine.js` is the product: the path a citizen walks to file a complaint.
It starts at `menu`, a question with two options — file a complaint, or cancel.
Choosing to file enters `fileComplaint`, a group holding the whole journey, so
every step inside it shares one parent and one entry action. The group begins at
`type`. Reading the file top to bottom gives you the journey in order, because
the states are declared first and wired immediately below.

Filing collects four things, in three groups. `type` walks the complaint
hierarchy from MDMS with a `WalkState`, descending one level per reply until it
reaches a leaf. `location` walks the boundary hierarchy the same way. `other`
holds three questions in sequence: which institution the complaint is about, a
free-text description, then optional attachments. Each walk hands its result to
the next group through `setOnLeaf`, naming the slot the answer lands in. The
boundary walk also wires `setOnEmpty` to the same place, so a tenant with no
boundary data configured still reaches the rest of the flow instead of stalling.

```js
// src/machine/pgr-machine.js - the three collecting groups
const typeGroup = new Group('type').setStates([walkComplaintTypes]).setStart('complaintType2Step');
const locationGroup = new Group('location').setStates([walkBoundaries]).setStart('boundary');
const otherGroup = new Group('other')
  .setStates([askIntitution, askDescription, askForAttachments])
  .setStart('institution');
```

The last four steps are about consent and confirmation. `consent` asks whether
the citizen agrees to their data being processed; answering no goes to
`consentDeclined` and ends the session, collecting nothing further.
`confidentiality` asks whether the complaint should be confidential and records
the answer either way. `confirmSubmission` shows a summary of everything
gathered, built by a fill function, and asks for a final yes. Answering no goes
to `cancelSession`. Only a yes reaches `persistComplaint`.

`persistComplaint` is the single `ProcessingState` in the journey. It calls the
PGR service, and on success sends an outcome message containing the complaint
number returned by the create call, then moves to `endstate`. A rejected promise
follows `setOnError` to the shared system-error state. Because every network call
in filing lives in this one state, there is exactly one place to look when a
complaint fails to save, and the states that talk to the citizen stay free of
service code.

Groups shape the state paths you will see in logs and in stored sessions. A
citizen answering the description question is at
`pgr.fileComplaint.other.description`. That path is worth reading as a sentence:
journey, group, sub-group, step.

## Part 8 — Slots: the answer bag



Answers accumulate in `context.slots.pgr`, a flat object: `complaint`,
`instituteName`, `description`, `image`, `city`, `locality`, `isConfidential`, plus
`hierarchyPath` and `boundaryPath`, which are the walks' working state rather than
answers as such. This bag is what becomes a complaint at the end, and it is cleared
whenever the citizen re-enters the grievance menu, so a new complaint never inherits
an old one.

A step writes to it by naming a `slot`. The generator does the assignment, so step
data never touches `context` directly for the common case. A `choose` step can also
transform the value on the way in: the confidentiality question stores a real boolean
rather than the string "Yes", which is what the backend expects and what the receipt
logic reads.

```js
// as written in pgr-machine.js / shell-machine.js
slot: 'instituteName'                            // -> context.slots.pgr.instituteName

slot: 'isConfidential',                          // with a transform on the way in
value: (intention) => intention === 'Yes'

set: (context, locale) => {                      // anywhere OUTSIDE the pgr bag
  context.user.locale = locale;
  context.onboarding.locale = locale;
}
```

For anything outside that bag — the citizen's locale, the onboarding name — a step
supplies a `set` function instead, receiving the context and the captured value. Two
mechanisms rather than one, but both are trivial and neither needs a path resolver.
Prefer `slot` whenever it fits, and reach for `set` only when the destination really
lives elsewhere.

The consumer is `persistComplaint` in `src/machine/service/egov-pgr.js`. It reads the
bag and builds the PGR request body, including an `extendedAttributes` object
carrying the institution name, the confidentiality flag and a deployment-level case
category. If you add a slot, that function is where it must be read — writing a slot
nobody reads is the easiest silent mistake here.

```js
// flow-state.js - a branch's optional `set` is what writes the answer
resolveBranches() {
  return this.branches.map((branch) => ({
    target: '#' + branch.state.key,
    cond: branch.cond || undefined,
    ...(branch.set ? { actions: assign(branch.set) } : {})   // -> the answer bag, or anywhere else
  }));
}

// flow-state-walk.js - a walk writes its own slot when it lands on a leaf
if (this.onLeaf.slot) context.slots.pgr[this.onLeaf.slot] = context.intention;

// egov-pgr.js persistComplaint - the other end of the contract
requestBody.service.description = slots.description ?? '';
requestBody.service.extendedAttributes = {
  caseRelatedTo:  config.caseRelatedTo,
  instituteName:  slots.instituteName,
  isConfidential: slots.isConfidential === true
};
```

There is no schema. Nothing stops a typo in a slot name from producing a complaint
with a missing field. The mitigation is a test asserting the exact set of slot keys
after a happy path, so a rename fails on the same commit that introduces it. Treat
that test as the contract, because it is the only one there is.

---

## Part 9 — Text and translation



All outbound text lives in message bundles: objects keyed by locale — `en_IN`,
`pt_PT` — with an optional `code`. Onboarding and chassis copy sits in
`flow/shell-messages.js`; filing copy sits in `flow/pgr-messages.js`. They are
ordinary data and safe to edit, kept next to the flow they serve rather than in a
separate translation tree.

`dialog.get_message(bundle, locale)` resolves one. If the bundle has a `code` it
first asks the localisation service for a live translation of that code; if that
yields nothing usable it falls back to the bundle's own text for the locale, and
failing that to `en_IN`. So translations can change in DIGIT without a deploy, while
the code still runs standalone.

```js
// flow/pgr-messages.js (filing) and flow/shell-messages.js (onboarding) hold these.
// A bundle: a localisation code plus per-locale fallback literals.
institution: {
  question: {
    code: 'chatbot.pgr.institution.question',    // asked of the platform FIRST
    en_IN: 'Which institution is your grievance about?',
    pt_PT: 'A que instituicao se refere a sua reclamacao?'
  }
}

// resolution order, from dialog.get_message:
//   1. live translation for `code` in the citizen's locale
//   2. this bundle's entry for that locale
//   3. this bundle's en_IN
```

`src/machine/util/localisation-service.js` fetches those translations once and
caches them, but not at module load — `app.js` calls `loadLocalisationOrExit()`
before it listens, retrying five times with a backoff and exiting 1 if they never
arrive. A pod that cannot reach the localisation service is restarted rather than
answering citizens with untranslated codes. It queries two tenants, the state root
and the deployment tenant, because the localisation search API returns rows from
the first tenant in the chain that matches and then stops rather than merging. That
detail has cost real debugging time.

Which languages the menu offers is decided in `flow/offered-locales.js`. A locale is
offered only if the platform declares it *and* every bundle in the journey has a
fallback literal for it. The platform side is weaker than it looks: the service's
coverage check proves only that a locale has some row at that tenant, not that the
chatbot has translations.

When that intersection is empty — the platform is unreachable, or declares only
locales no bundle can serve — the menu falls back twice rather than showing
nothing: first to whatever the bundles *can* serve, then to `config.defaultLocale`.
A locale reached this way is labelled with its own code, because the platform
never supplied a label. Seeing `en_IN` in the menu instead of `ENGLISH` is
therefore a symptom worth chasing, not a cosmetic bug.

Placeholders use double braces: `{{maxLength}}`, `{{statements}}`, `{{name}}`,
`{{options}}`, and positional `{{1}}` `{{2}}` `{{3}}` in the filing receipt. The
generator substitutes them from the step's `fill` map, and a `choose` step gets
`{{options}}` for free. A placeholder with no matching entry is left in the text —
visible, which is the point.

```js
// flow-state.js - substitution. Two behaviours worth noting, both deliberate.
renderText(bundle, fill, context, event) {
  let text = dialog.get_message(bundle, context.user.locale);
  for (const token of Object.keys(fill || {})) {
    const marker = `{{${token}}}`;
    if (!text.includes(marker)) continue;                        // absent -> never evaluated
    const raw = fill[token];
    const value = typeof raw === 'function' ? raw(context, event)
      : (raw && typeof raw === 'object' ? dialog.get_message(raw, context.user.locale) : raw);
    text = text.split(marker).join(String(value ?? ''));         // nullish -> empty string
  }
  return text;
}

// and a `choose` step gets {{options}} for free:
const fill = step.options ? { options: () => renderOptions(optionsOf(step)), ...step.fill } : step.fill;
```

Two rules about substitution, both learned the hard way. A `fill` value resolving to
nothing renders as an empty string, not the word "undefined" and not a stray comma.
And a `fill` entry whose placeholder does not appear in the text is never evaluated,
so a function that would throw on missing data does not get the chance.

Reused platform keys are worth knowing. The consent statements and the
confidentiality label point at the same localisation codes the web portal uses, so
the bot and the portal cannot drift apart in wording. When you add citizen-facing
text, check whether the portal already has a key for it before inventing one.

---

## Part 10 — Understanding what the citizen typed



The bot recognises replies by *grammar*: a list of `{ intention, recognize }` pairs,
where `recognize` is an array of accepted strings and `intention` is the symbol the
machine reasons about. `dialog.get_intention(grammar, event, true)` returns the
matching intention or a sentinel meaning "not understood". The third argument selects
exact matching, and every live call uses it.

```js
// what choiceGrammer builds from options: ['Yes', 'No']
[
  { intention: 'Yes', recognize: ['1', 'yes'] },
  { intention: 'No',  recognize: ['2', 'no'] }
]

// get_intention lowercases and trims the input, then matches exactly (strict = true)
context.intention = dialog.get_intention(grammer, event, true);   // or INTENTION_UNKOWN
```

The product is deliberately numbers-first. A menu of three options accepts "1", "2",
"3". This is not laziness: it works on every handset, needs no translation, and
avoids the ambiguity of free text in a language the bot may not have been tested in.
Confirmations additionally accept the word forms, so "yes" works as well as "1".

For a `choose` step the grammar is derived from the step's `options`, so the prompt's
numbering and the recognition come from the same list and cannot disagree. This
matters more than it sounds: two hand-written confirmation grammars had once drifted,
so "yes" was accepted at the name confirmation and rejected at the consent question
for no reason anybody intended.

A step may extend the accepted spellings with `recognize`. The language menu uses it
to accept the option's label as well as its number, including a diacritic-stripped
form — so a citizen typing `portugues` selects `PORTUGUÊS`. Without that, generating
that step from its options alone would have accepted only the number and the locale
code.

There is an important asymmetry in where grammars live. A static option set is a
compile-time constant held in the emitter's closure. A runtime list — the language
menu, or a fetched tree level — must survive to the next HTTP request, so it is
stored in `context.grammer`. Storing a constant there would add a way to fail for no
benefit.

```js
// flow-state-question.js - options are resolved on entry, into a per-state slot
get optionsSlot() { return this.key + 'Options'; }

question: {
  entry: [
    assign((context) => { context[this.optionsSlot] = this.resolveOptions(context); }),
    (context) => this.enter(context, { options: () => this.renderOptionsList(context[this.optionsSlot] || []) })
  ],
  on: { USER_MESSAGE: 'process' }
},
process: {
  entry: assign((context, event) => {
    context.intention = this.matchReply(context, event);   // null when not understood
  }),
  });
}
```

`validateInputType(event, accepted)` is the separate question of *kind*: was this
text, an image, a document, a location, or a button reply? Text questions accept text
and interactive button replies. The attachment question accepts images and documents.
This check always runs before interpretation, in every class that reads a reply, so
an image sent where text was expected becomes a retry rather than a crash.

---

## Part 11 — The tree walks



Two questions in the product are not really questions but descents through a tree of
unknown shape: the complaint category and the administrative area. Both are driven
entirely by backend data. Neither the depth nor the labels appear in the code, which
is why a deployment can restructure its categories without anyone touching this
module.

A walk is five states. `fetch` invokes the backend for the current level. `evaluate`
looks at what came back and decides whether there is anything to ask. `question`
renders the numbered list and waits. `process` interprets the choice. `error`
retries. The cycle repeats one level per pass until a level announces itself as the
last.

The path so far lives in a slot — `hierarchyPath` or `boundaryPath` — as an array of
codes. Descending pushes the chosen code; going back pops it. The fetch function
receives that array and returns the level below it, along with the labels to display
and a flag saying whether this level is a leaf.

`process`'s guard order is the subtlety, and the generator fixes it for good reason.
Go-back is tested first, because "Go Back" is a real grammar entry and would
otherwise satisfy the later guards — choosing it at a leaf level would have filed a
complaint whose category was literally "goback". Leaf is tested before descend, or
the leaf's own code gets pushed and the next fetch runs against nothing.

```js
// flow-state-walk.js process - the order is fixed by the class, not the author
always: [
  { target: 'fetch',                     cond: (c) => c.intention === INTENTION_GOBACK,
                                         actions: <pop the path> },            // 0: go back first
  { target: '#' + onLeaf.state.key,      cond: (c) => recognised(c) && c[stepSlot].isLeafLevel,
                                         actions: <push, write the slot> },    // 1: leaf BEFORE descend
  { target: 'fetch',                     cond: (c) => recognised(c),
                                         actions: <push> },                    // 2: descend
  { target: 'retry' }                                                          // 3: not understood
]
```

Missing fetched data is handled by structure rather than by a guard. A walk's first
child is `fetch`, so a conversation resumed mid-walk re-enters there, fetches the
level again from the path it still holds, and re-asks. That costs the citizen one
prompt and removes the case where the leaf flag is read off `undefined`.

`evaluate` exists for the case of a level with no options. For the boundary walk that
means the citizen has descended as far as the data goes, so it records what it has
and moves on. The category walk has no such escape, deliberately: there is no sound
complaint to file without a category.

The backend side lives in `src/machine/service/egov-pgr.js`.
`fetchComplaintHierarchyStep` reads the MDMS category definition and rows, orders any
"Other" option last, and returns exactly one level. `fetchBoundaryStep` does the
equivalent against the boundary hierarchy. Both return the same shape — options,
labels, a level name and a leaf flag — which is precisely why one emitter can serve
both walks.

---

## Part 12 — XState v4, from zero



A **machine** is a description of states and the transitions between them. It is
inert data — creating one runs no logic. `Machine({ id, initial, states })` returns
that description. In this codebase there is exactly one machine, assembled in
`src/machine/state-machine.js`, and everything else is a fragment merged into it before it is
constructed.

A **state node** is one entry in `states`. A node with no children is a leaf, and
the machine rests in leaves. A node with a `states` object of its own is *compound*:
entering it means entering its `initial` child. Compound states give the
conversation its structure — "we are in the filing journey, in the location group,
at the question".

```js
// atomic: the machine can rest here
endstate: { id: 'endstate', always: [{ target: '#start' }] }

// compound: entering it means entering its `initial` child
institution: {
  id: 'institution',
  initial: 'question',
  states: { question: {...}, process: {...}, error: {...} }
}
```

An **event** is something that happens to the machine. This codebase uses three:
`USER_MESSAGE`, `USER_RESET` and `USER_CANCEL`. That is the entire alphabet, and
the last two exist only because they are handled at the root — a citizen must be
able to escape from anywhere. Every other branch in the dialogue is decided not by
the event type but by inspecting the text that arrived with it, which is why most
interesting logic lives in guards rather than in event names.

A **transition** says: on this event, in this state, go there. Written as
`on: { USER_MESSAGE: 'process' }`. A transition may name a sibling by bare name, or
any state anywhere by `#id` if that state declared `id: 'something'`. The `#id` form
is how the machine jumps between distant parts of the tree, and you will see it
throughout the generated output.

**Context** is the machine's memory: one plain object carried alongside the state
value. Here it holds the citizen's identity, the tenant, the answers gathered so
far, and some scratch data. Unlike the state value, context is unstructured — it is
whatever the code puts there, which is both convenient and the source of several
historical bugs.

An **action** is a side effect attached to entering a state or taking a transition.
`onEntry` runs on entry. In v4, actions that change context must be wrapped in
**`assign`**. This codebase uses `assign` for everything, including sending
messages — technically an impurity, but it is consistent and changing it would be a
separate refactor.

```js
// v4 requires assign() for anything that touches context.
// Note the braces: a bare arrow returning an object would REPLACE the context.
onEntry: assign((context, event) => {
  context.intention = dialog.get_intention(grammer, event, true);
})
```

A **guard** — written `cond` — is a predicate deciding whether a transition may be
taken. When several transitions are listed for the same event, XState tries them in
order and takes the first whose `cond` passes. **Order is therefore semantic, not
cosmetic.** Reordering a guard array can change behaviour, and in the tree walks it
definitely does.

```js
// tried in order; the FIRST passing cond wins, so this order is behaviour
always: [
  { target: 'fetch',    cond: (c) => c.intention === dialog.INTENTION_GOBACK },  // must be first
  { target: '#consent', cond: (c) => c[step.stepSlot].isLeafLevel },             // leaf before descend
  { target: 'fetch',    cond: (c) => c.intention !== dialog.INTENTION_UNKOWN },
  { target: 'error' }                                                           // the safety net
]
```

An **eventless transition** — written `always` — fires as soon as the machine enters
the state, without waiting for input. This is how the bot chains automatic steps: a
state sends a message on entry, then `always` moves straight on. A guarded `always`
array is a fork. A state whose `always` has no unconditional last entry can get
stuck forever.

**`invoke`** starts an asynchronous job on entry, usually a promise. Its `onDone`
transition fires when the promise resolves, with the resolved value on `event.data`;
`onError` fires when it rejects. Every backend call made during a conversation goes
through `invoke`. A state with `invoke` and no `onError` wedges if the call fails.

```js
invoke: {
  id: 'fetchBoundaryStep',
  src: (context) => step.fetch(context, context.slots.pgr[step.pathSlot] || []),
  onDone: { target: 'evaluate', actions: assign((c, e) => { c[step.stepSlot] = e.data; }) },
  onError: { target: '#system_error' }   // omit this and a failure wedges the conversation
}
```

An **interpreter** — created by `interpret(machine)` and started with `.start()` —
is a running instance, called a *service*. The machine is the recipe; the service is
the meal. `service.send(event)` drives it. `service.state` is the current snapshot,
exposing `.value`, `.context`, `.done`, and `.matches(...)`. Here a service lives
for exactly one HTTP request.

Finally, **serialisation**. `service.state` can be JSON-stringified and later revived
with `State.create(json)` and `machine.resolveState(state)`. That pair is what lets
a conversation survive between requests, and its failure modes are the subject of
Part 17. Note what does *not* come back: entry actions do not re-run, and invoked
promises do not restart.

One more v4 detail that has already caused a real bug here. Eventless transitions
are resolved under the *null event*, so inside an `always` transition's action
`event.data` is `undefined` — the payload that triggered the transition is not
visible. Only **entry** actions see the real event. Part 6 explains where that
matters.

```js
// WRONG: inside an `always` action the null event is in scope, so data is undefined
always: { target: '#welcome', actions: assign((c, event) => report(event.data)) }

// RIGHT: an entry action sees the real error.platform event
onEntry: assign((c, event) => report(event.data))
```

---

## Part 13 — Keys, ids and nesting



Every state is constructed with a key, and that key becomes its XState state name.
Groups also carry their key as an `id`, which is what makes absolute targets work:
a state anywhere in the tree can jump to `#endstate` without knowing how deeply it
sits. You write keys, never `#` prefixes, except in the few places a target
deliberately crosses journeys.

Wiring is by object reference. `setNext(description)` takes the state itself, so a
misspelled name is an undefined variable that throws when the file loads, not a
transition that silently goes nowhere. This is the main safety property of the
class model, and it is why there is no separate target-resolution table.

Crossing between journeys needs one trick. `pgr-machine.js` declares placeholder
states for `endstate` and `system_error` so its own steps can target them by
reference, but leaves them out of the list passed to `compile()`. Because they are
never compiled into the filing subtree, `#endstate` resolves to the real chassis
state in the shell instead of a same-named node nested inside `pgr`. If you add a
shared chassis state, follow that pattern: declare the placeholder, wire to it,
and keep it out of the compile list.

## Part 14 — The compiler



`flow/flow-state-compiler.js` is twelve lines. `compile(states, initialKey)`
walks the list, calls `compileNode()` on each state, and returns an XState config
with those states and the given initial key. That is all it does. There is no
emitter per step kind and no shared helper layer, because each class emits its own
node — the knowledge of what an ask step becomes lives in `AskState`, next to the
setters that configure it.

```js
// src/machine/flow/flow-state-compiler.js - the whole file
function compile(states, initialKey) {
  const config = { initial: initialKey, states: {} };

  for (const state of states) {
    config.states[state.key] = state.compileNode();
  }

  return config;
}
```

This is the practical difference from a central generator. To learn what a step
compiles into, open its class and read `compileNode()`; you are never tracing
through a large file that handles every kind at once. To add a kind, write a class
with the setters it needs and a `compileNode()` that returns its node — no file
outside that class changes. The cost is that the XState knowledge is spread across
six small files rather than one large one, which is the trade the class model
makes deliberately.

`Group.compileNode()` works the same way, returning a compound node with its own
`id`, `initial` and nested states, and attaching an entry action when
`setOnEntry` was used.

## Part 15 — The triplet: the core idiom



Any state that waits for a reply compiles into three children, and once you see
the pattern the machine becomes easy to read. They are `question`, `process` and
`retry`, nested under a compound node named after the step. `QuestionState` and
`AskState` both emit this shape from their own `compileNode()`, so a menu and a
free-text question behave the same way even though what counts as a valid answer
differs. States that never wait — `State`, `ProcessingState`, `GateState` — emit
a single node instead.

`question` is the only child with an `on` handler. On entry it sends the prompt,
then waits for `USER_MESSAGE`, which moves it to `process`. Nothing else happens
here: no validation, no branching. Keeping the wait in a state of its own is what
makes a conversation resumable, because a stored session that points at
`…description.question` is precisely a conversation waiting for that answer.

```js
// src/machine/flow/flow-state-ask.js - the shape every waiting state emits
{
  id: this.key,
  initial: 'question',
  states: {
    question: { entry: ..., on: { USER_MESSAGE: 'process' } },
    process:  { entry: ..., always: [{ target: 'retry', cond: invalid }, ...branches] },
    retry:    { entry: ..., always: 'question' }
  }
}
```

`process` does the work and never waits. Its entry action interprets the reply —
`QuestionState` matches it against the options and records an intention,
`AskState` checks the input type, runs `validate`, and writes the answer into
context when it passes. Then an `always` array decides where to go. The first
entry sends an invalid or unrecognised reply to `retry`; the rest are the
branches you declared with `setNext` and `setConditionalNext`, in the order you
declared them.

`retry` sends a message and goes straight back to `question`. Which message
depends on what failed: a validator may return specific text, such as telling the
citizen a name is too long, and the class falls back to the step's own retry
prompt, then to a generic one. Because `retry` loops to `question` rather than
advancing, a citizen who answers badly is asked the same thing again rather than
carried forward with a missing answer.

This three-state shape is why state paths are longer than you might expect and
why they are useful. `pgr.fileComplaint.other.description.question` tells you the
citizen is being asked for a description; the same path ending in `.retry` tells
you they just answered it wrongly.

## Part 16 — The session layer



`src/session/` turns HTTP into conversation. It is deliberately several small files
rather than one: `session-manager.js` orchestrates, two login flows resolve identity,
`chat-service.js` owns the machine, `chat-state.js` wraps the persisted blob,
`session.js` names the resolved citizen, and `inbound-message-parser.js` plus
`upload-tenant.js` handle the inbound request. Each one is readable in a sitting.

`session-manager.js` is 110 lines and does four things in `authenticateAndDispatch`:
wrap the payload in a model, choose a login flow, resolve a session, dispatch. It
also exposes `toUser` — the outbound path machine code reaches through
`context.chatInterface` — and holds the sandbox tracker plus a housekeeping timer
that expires stale entries.

```js
// src/session/session-manager.js - the whole turn, four steps
async authenticateAndDispatch(rawRequestModel) {
  const inboundRequestModel = InboundRequestModel.create(rawRequestModel);

  const loginFlow = config.isSandboxMode
    ? new SandboxLoginFlow(inboundRequestModel, sandboxOrgTracker, getAuthenticatedSandboxUser)
    : new StandardLoginFlow(inboundRequestModel);

  const session = await loginFlow.resolveSession();
  if (!session) return;              // the flow already replied to the citizen

  await this.chatService.dispatch(session, inboundRequestModel);
}
```

There are two login flows behind one contract, `resolveSession()`.
`StandardLoginFlow` resolves the mobile number to a DIGIT user, creating one if
needed, and returns a session. `SandboxLoginFlow` handles the multi-organisation
email flow used by sandbox deployments. Either may return `null`, meaning it has
already replied to the citizen and the turn is over.

`chat-service.js` is where the machine lives, and `dispatch` is the turn. Before
anything else it asks `resumePromptVerdict` whether this message is the answer to a
resume prompt — a citizen returning after a gap is offered their old conversation
back, and until they answer, their reply means something different from usual. A
reset or cancel word overrides the prompt; an expired one is abandoned; otherwise
the answer decides whether the old state is revived or discarded. Only past that
does the ordinary path run: load or create the state, rotate the session id, log
telemetry, build a service, send one event.

The turn does not end when the event is sent. `waitUntilSettled` waits for the
machine to come to rest, because an invocation still running means nothing has been
persisted yet — Part 17 explains why such a state is deliberately not written. If
it never settles within `DISPATCH_SETTLE_TIMEOUT_MS` the interpreter is stopped and
`abandonStalledSession` tells the citizen rather than leaving them with silence.
`dispatch` then returns the persistence queue, so the next message cannot overtake
the write for this one.

```js
// src/session/chat-service.js - one turn, start to finish
async dispatch(session, inboundRequestModel) {
  const sessionUserId = session.userId;

  const verdict = await this.resumePromptVerdict(sessionUserId, inboundRequestModel);
  if (verdict === "answer")   return this.resolveResumeChoice(session, inboundRequestModel);
  if (verdict === "override") return this.restartSession(session, inboundRequestModel, ...);

  const chatState = await this.getOrCreateChatState(sessionUserId, session.user, inboundRequestModel);
  if (!chatState) return;                     // awaiting the citizen's resume/restart choice

  await chatStateRepository.updateSessionId(sessionUserId, config.avgSessionTime);  // idle -> new session id
  telemetry.log(sessionUserId, "from_user", inboundRequestModel);

  const stateMachineService = this.getStateMachineServiceFor(chatState, inboundRequestModel);

  const message = inboundRequestModel.getMessage();
  const event = message.isCancel() ? "USER_CANCEL"
              : message.isReset()  ? "USER_RESET"
              : "USER_MESSAGE";
  stateMachineService.send(event, inboundRequestModel);

  if (!await waitUntilSettled(stateMachineService)) {        // invoke still running past the timeout
    this.abandonStalledSession(session, inboundRequestModel);
  }
  return pendingPersist(sessionUserId);                      // the next message waits on this write
}
```

`getStateMachineServiceFor` is the other interesting half: it rehydrates, attaches
the persistence listener, and handles the case where rehydration fails.

`chat-state.js` is a small value wrapper around the serialised blob. It names the
parts the rest of the layer needs — `context`, `value` — and offers
`toPersistableState()`, which deep-clones and then strips the user object down to
locale, userId and mobile number. Callers that need the un-stripped state must clone
first, which the method name says.

`inbound-message-parser.js` takes the channel adapter and the upload tenant from its
caller rather than importing them, so parsing carries no session or identity
dependency. It does reach for `env-variables` and the shared error types, but
nothing that knows who the citizen is. The tenant decision lives in `upload-tenant.js`, which is the
one place that knows an attachment in sandbox mode belongs to the citizen's
registered tenant.

The neutral payload gets two thin model classes in `src/machine/util/`.
`InboundRequestModel` names `user`, `message` and `extraInfo`; `InboundMessage` names
`input` and `type` and answers questions about them, notably `isReset()`, which is how
a greeting becomes `USER_RESET`. Both are transport shapes rather than machine
concepts, which is why they carry no dialogue logic.

`InboundMessage.create` checks the message type against a known list — `text`,
`image`, `document`, `location`, `button`, plus `unsupported` and `unknown` for
audio, stickers and bodyless webhooks. An unrecognised type is not an error: it
degrades to `unsupported` with a warning. That matters because `getMessage()` is
called after the chat-state row is written and the interpreter started, so a throw
here would lose the whole turn and leave the citizen with an English error from
`error-handler.js` instead of a re-prompt in their own language.

---

## Part 17 — Saving and resuming a conversation



After every transition the persistence listener serialises the state, strips the user
object down to locale, userId and mobile number, and writes it to the
`eg_chat_state_v2` table against the citizen's id, along with telemetry describing
the move. Two transitions in one turn would otherwise race, so writes do not go
straight to the repository: they are queued per citizen in `persist-queue.js` and
run in order, and `dispatch` awaits the queue before the turn ends. That is also
what stops a message arriving straight after from reading a half-written state.

A transition with an invocation still in flight is skipped entirely. Restoring such
a state re-runs the invocation on the next message, which for `persistComplaint`
means filing the complaint twice — Part 12's note on what `interpret().start()`
does with a persisted state is the mechanism, and this guard is the defence.

```js
// src/session/chat-service.js - attached to every service it builds
stateMachineService.onTransition((state) => {
  if (!state.changed) return;
  if (hasActiveInvoke(state)) return;          // never persist mid-invocation

  const userId = state.context.user.userId;
  const active = !state.done && !state.forcedClose;
  const persistableState = ChatState.create(state).toPersistableState();  // clone + strip user

  enqueuePersist(userId, async () => {         // chained per citizen, awaited by dispatch
    await chatStateRepository.updateState(userId, active, persistableState.state, timeStamp);
    telemetry.log(userId, "transition", {
      source:      sourceStrings[sourceStrings.length - 1],   // from state.history.toStrings()
      destination: stateStrings[stateStrings.length - 1]      // from state.toStrings()
    });
  });
});
```

Which repository is used depends on `REPO_PROVIDER`. The default is `InMemory`, so a
restart forgets every conversation — fine for local work, useless in production.
`postgres-repo.js` is the real one. The distinction catches people out when a local
session survives nothing and they go hunting for a bug that is a default value doing
its job.

On the next message the stored JSON is revived: `State.create` rebuilds a state
object, `machine.resolveState` reattaches it to the machine, and
`interpret(machine).start(resolved)` resumes there. The citizen's identity and tenant
are refreshed from the incoming message first, since the stored copy was deliberately
trimmed down to a locale, a userId and a mobile number.

Three things do **not** come back, and each has bitten this codebase. Entry actions
do not re-run, so anything a state wrote on entry must have been persisted. Invoked
promises do not restart, so a conversation saved while waiting on a backend call
cannot advance on its own. And the "changed" flag is absent, which incidentally
prevents a crash in the transition logger.

The dangerous failure is a stored position naming a state the machine no longer has —
the inevitable result of renaming a state and deploying. `resolveState` throws, and it
throws *before* the event is sent, so the reset keyword cannot save the citizen
either. The row stays active and every future message repeats the same throw. That is
a permanent brick.

The fix is small and important: rehydration is wrapped, and on failure the error is
logged and a fresh conversation starts, carrying forward only the citizen and the
tenant. The stale answer bag and grammar are deliberately discarded, because they
describe a position that no longer exists. The citizen sees the welcome message and
carries on.

```js
// src/session/chat-service.js
resolvePersistedState(chatState, context) {
  try {
    return stateMachine.withContext(context).resolveState(State.create(chatState.raw));
  } catch (error) {
    console.error(`Discarding unresolvable chat state for user ${context.user.userId}: ${error.message}`);
    return null;                     // caller starts fresh, carrying only user + tenant
  }
}
```

One consequence worth knowing: conversations are never marked complete in practice,
because the end state loops back to `start` rather than being declared final. So the
active flag stays true and old state is always revived. The resume fallback is what
makes that arrangement safe rather than fragile, which is why it is not optional.

---

## Part 18 — Channels



`src/channel/index.js` picks one adapter at startup from `WHATSAPP_PROVIDER`:
`Twilio`, `ValueFirst`, `Kaleyra`, or the console fallback. Every adapter implements
the same three functions — `processMessageFromUser` inbound, `sendMessageToUser`
outbound, and `verifyRequest` to answer for a request's authenticity — and nothing
else in the codebase knows or cares which one is active. The choice is made once,
at require time, and an adapter missing `verifyRequest` throws there rather than
being discovered later as no check at all.

```js
// src/channel/index.js - one decision, made once at require time
if (config.whatsAppProvider == 'ValueFirst')   module.exports = valueFirstWhatsAppProvider;
else if (config.whatsAppProvider == 'Kaleyra') module.exports = require('./kaleyra');
else if (config.whatsAppProvider == 'Twilio')  module.exports = require('./twilio');
else                                           module.exports = consoleProvider;

if (typeof module.exports.verifyRequest !== 'function') {   // every provider must answer
  throw new Error(`Channel provider '${config.whatsAppProvider}' does not implement verifyRequest.`);
}
```

How each adapter answers differs, and the difference matters. Twilio signs its
webhooks, so `twilio.js` recomputes the HMAC-SHA1 over the public URL and the form
body and compares it to `X-Twilio-Signature`. ValueFirst and Kaleyra sign nothing,
so both fall back to `channel/shared-secret.js`: a value the operator configures on
both sides, presented as a header or a query parameter and compared in constant
time. That is weaker — a bearer value, replayable, only as good as the TLS around
it — but it is the difference between "anyone who finds the URL can file complaints
as any citizen" and "you need the secret".

Both schemes fail closed. An unset `TWILIO_AUTH_TOKEN` or `WEBHOOK_SHARED_SECRET`
rejects every webhook rather than waving it through, because an unconfigured
deployment is exactly the state an attacker benefits from. The console adapter
verifies nothing and says so at startup, which is fine for a terminal and the
reason `WHATSAPP_PROVIDER=console` must never reach a reachable deployment.

The console adapter is how you develop. It reads from and writes to the terminal,
needs no external account or public URL, and exercises the identical machine. If you
are changing dialogue, use it: the loop is seconds rather than minutes and you can
read the whole transcript at once, which is the only practical way to judge wording.

The Twilio adapter handles form-encoded webhooks: `From`, `To`, `Body`, `MediaUrl0`,
`MediaContentType0`. Outbound numbers must be built as
`whatsapp:+<country><national>`, and getting that wrong produces a Twilio error code
rather than a delivered message — which from the outside looks exactly like the bot
ignoring the citizen. The country prefix comes from configuration.

Media handling is where adapters do real work, and it is not a pure parse. An inbound
image arrives as a URL; the adapter downloads it with account credentials and uploads
it to filestore, returning the file id as the message input. So calling
`processMessageFromUser` twice per request would upload twice and orphan the first
file.

Interactive button replies arrive with a distinct type but a plain string payload.
Text questions accept them for that reason: a citizen tapping a quick-reply button is
answering the question, and rejecting that would be a bug waiting for the day rich
templates are switched on. No outbound template currently uses buttons.

---

## Part 19 — The backend services



`src/machine/service/service-loader.js` is a thin indirection exporting the service
objects. It exists so tests can replace them wholesale. Anything that talks to the
network should be reachable through it, and code that captures a service at module
load time defeats that — a mistake worth avoiding when you add a new module here.

```js
// src/machine/service/service-loader.js - the whole file
console.log("Using eGov Services");
console.log('Using PGR v2');
module.exports.pgrService = require('./egov-pgr');

if (config.kafka.kafkaConsumerEnabled) {
  module.exports.pgrStatusUpdateEvents = require('./pgr-status-update-events');
}

// pgr-machine.js pulls the services it needs from the loader, so a test can
// stub the loader and exercise the flow without touching the network
```

`egov-pgr.js` is the large one. Besides the two walk functions it holds
`persistComplaint`, which assembles and posts the complaint; `fetchMdmsData`, the
generic MDMS query everything else is built on; and the filestore upload and
download helpers used by the attachment step. Most backend contact is here.

`egov-user-profile.js` saves the citizen's name and language during onboarding.
`user-service.js` in the session layer resolves a mobile number to a DIGIT user,
creating one if needed. Normalising that number is its own service:
`mobile-validation-service.js` reads `common-masters.MobileNumberValidation` from
MDMS for the tenant, cached with a TTL, and falls back to `DEFAULT_COUNTRY_CODE`
and `DEFAULT_MOBILE_REGEX` when no row exists or MDMS is unreachable — the bot
keeps answering either way.

Reading the rule from MDMS rather than from this module's own config is what makes
inbound and outbound agree. egov-user, egov-hrms, digit-ui and novu-bridge all read
the same row, so a citizen stored as `712345678` by the portal is found as
`712345678` here. Resolution copies novu-bridge's: first active row with
`default: true` wins, looked up at the tenant and then at its state root. Get this
wrong and the bot creates a second user for a citizen who already exists.

Requests to DIGIT need an authenticated envelope, and MDMS in particular is sensitive
to the tenant in the query. When a lookup returns nothing, suspect the tenant before
suspecting the data — Part 20 explains why that is the usual cause. An empty options
list is the symptom, and because that is not an error it surfaces as an odd-looking
prompt.

Failures are surfaced rather than swallowed. Every `invoke` that can reject routes to
`#system_error`, which apologises to the citizen and reports the payload. One caveat
worth knowing: a *synchronous* throw inside an `invoke` source — a typo'd method
name, for instance — escapes `onError` entirely and takes the process down rather
than reaching that state.

---

## Part 20 — Tenants



DIGIT tenancy is hierarchical: a state root such as `mz` with cities beneath it such
as `mz.ige`. The distinction is not cosmetic, and getting it wrong produces empty
lists rather than errors, which is why it is worth learning before your first
debugging session. Most "the bot shows no categories" reports trace back to a tenant
mismatch.

`ROOT_TENANTID` tells the bot which tenant to work in, and it drives four things at
once: which tenant complaints are filed against, where citizens are looked up and
created, which MDMS category data is read, and which localisation rows are fetched.
One variable, four consequences, which is why changing it is never a small change.

```text
// the same variable, reached from four different places
standard-login-flow.js   extraInfo.tenantId = config.rootTenantId       // the turn's tenant
standard-login-flow.js   userService.getUserForMobileNumber(mobile, config.rootTenantId)
pgr-machine.js           pgrService.fetchBoundaryStep(context.extraInfo.tenantId, path)
localisation-service.js  const stateTenantId = String(config.rootTenantId).split('.')[0];
```

Filing is one step further removed. `persistComplaint` takes its tenant from the
`city` slot, which the boundary walk fills from `context.extraInfo.tenantId` —
itself set to `ROOT_TENANTID` by the standard login flow. So the variable still
decides it, but through the conversation rather than directly, and a sandbox login
can override it mid-turn. In this deployment complaints land at the city tenant,
because that is where the real category tree and the real boundaries live. The state root holds only
demonstration data and no boundaries at all, which would dead-end the location walk
on its first level. The workflow definition resolves at the state root regardless.

Localisation cuts the other way: translated strings live at the state root, not the
city. That asymmetry is exactly why the localisation service queries both tenants and
merges the results itself rather than trusting one query. Seed translations against
the wrong tenant and they load without error and simply never appear in a message.

---

## Part 21 — Configuration



`src/env-variables.js` is the single place environment variables are read, and every
one has a default there. Its first line loads `.env` through dotenv, so a local run
needs only a file next to `package.json`; `.env.example` shows the shape and `.env`
itself is gitignored. A real environment variable always wins over the file, which
is how the same image runs unchanged under Helm. Defaults in this file are not the
whole story — Part 22 covers the ones the service refuses to boot without.

There are around 135 variables now, but they fall into seven groups. Identity and
routing: port, context path, channel provider, repository provider, business
number. Tenancy: root tenant and supported locales. Country: dialling code,
national number length, and the MDMS fallback rules. Product limits: minimum
description length, maximum institution name length, maximum media size, and the
case category recorded on every complaint.

The other three arrived with the service's operational surface. Credentials and
secrets: the service account, the Twilio pair, `WEBHOOK_SHARED_SECRET`,
`REMINDER_AUTH_TOKEN` — these are the ones Part 22 refuses to boot without.
Timeouts: `REQUEST_TIMEOUT_MS` for a single backend call, `MEDIA_PROCESSING_TIMEOUT_MS`
for a download-and-upload round trip, and `DISPATCH_SETTLE_TIMEOUT_MS` for a whole
turn. The last must be the largest, or a turn is abandoned while a call it is
waiting on is still legitimately running. And switches: `ENABLE_SANDBOX_MODE`,
`DEV_PROXY_ENABLED`, `TWILIO_VERIFY_WEBHOOK_SIGNATURE` — each one changing what the
service will accept, which is why none of them defaults to the permissive value.

```js
// src/env-variables.js - every value has a default, so nothing is required
rootTenantId:          process.env.ROOT_TENANTID           || 'pg',
supportedLocales:      process.env.SUPPORTED_LOCALES       || 'en_IN',

// Phone identity is per-country CONFIG, not code.
countryCode:           process.env.COUNTRY_CODE            || '91',
mobileNumberLength:    parseInt(process.env.MOBILE_NUMBER_LENGTH || '10', 10),

descriptionMinLength:  parseInt(process.env.DESCRIPTION_MIN_LENGTH || '20', 10),
instituteNameMaxLength:parseInt(process.env.INSTITUTE_NAME_MAX_LENGTH || '300', 10),
isSandboxMode:         process.env.ENABLE_SANDBOX_MODE === 'true',
```

The country group exists because the code once assumed India in several places. Every
one of those is gone: `src/phone-numbers.js` holds the one pair of conversions the
adapters share, and the validation rule itself comes from MDMS per tenant rather than
from this file at all — Part 19 has the detail. `COUNTRY_CODE` and
`MOBILE_NUMBER_LENGTH` remain as the fallback when a tenant publishes no rule. A
literal country code anywhere in the source is a bug rather than a shortcut.

Product limits are read through configuration for the same reason: the minimum
description length appears both in the validation and in the prompt text, via a
placeholder. Change the variable and both move together. Hardcoding it in either
place guarantees they will eventually disagree, which is an unpleasant bug to receive.

---

## Part 22 — What fails at boot, and why that is good

Three gates stand between `node src/app.js` and a listening port, and they run in
that order. `warnAtStartup()` prints what is degraded but survivable.
`assertRequiredConfigOrExit()` exits 1 on anything that cannot work at all.
`loadLocalisationOrExit()` fetches the translations, retrying five times with a
backoff, and exits 1 if they never arrive — so an orchestrator restarts the pod
rather than serving a conversation with no words in it.

What counts as fatal depends on the channel, because demanding Twilio credentials
of a ValueFirst deployment would be its own kind of wrong. `src/startup-checks.js`
holds both lists, and `test/startup-checks.test.js` pins each case.

| Setting | Fatal when |
|---|---|
| `USER_SERVICE_ACCOUNT_USERNAME` / `_PASSWORD` | always — they default to empty strings, so the first citizen gets a blank OAuth post |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | `WHATSAPP_PROVIDER=Twilio` |
| `TWILIO_WEBHOOK_BASE_URL` | Twilio, and signature verification is on |
| `WEBHOOK_SHARED_SECRET` | ValueFirst or Kaleyra, and verification is on |

The warnings are the other half, and each names its consequence rather than the
setting alone: an unset `TWILIO_WHATSAPP_NUMBER` files complaints but drops every
reply; `TWILIO_VERIFY_WEBHOOK_SIGNATURE=false` leaves the webhook forgeable by
anyone who learns the URL; `REPO_PROVIDER=InMemory` loses conversations on restart
and breaks outright with more than one replica. `GET /health` returns 503 with the
same list, so a degraded deployment is visible to a probe and not only to whoever
happened to read the startup log.

Wiring is by object reference, so most mistakes are impossible to express. A step
points at another step by naming the variable holding it; a typo is an undefined
variable, and the file throws while it is being loaded. That happens as the service
starts, before it accepts a single message, which is the cheapest moment to find out.
There is no separate target table to keep in step with the states.

A group compiles its `setStart` key into the node's `initial`. A group built without
one produces a compound node with no initial child, and XState throws when `Machine()`
is called — again at startup. Every group in the code sets it today, so this is a
guard against a future edit rather than a live concern.

One thing is not checked: duplicate keys. XState v4 does not detect two states sharing
an `id`, and nothing in the flow classes does either. Two states constructed with the
same key in different journeys compile into different subtrees, and an absolute target
like `#endstate` resolves to whichever one the interpreter finds first. The filing
journey relies on exactly this, declaring placeholder `endstate` and `system_error`
states and leaving them out of its compile list so the shell's real ones win. That
makes key choice something to think about: reuse a key by accident and a transition
lands somewhere plausible but wrong, with no error anywhere.

The principle behind all of this is worth stating plainly. A flow error that surfaces
at startup costs a failed deploy. The same error surfacing when a citizen reaches that
step costs one wedged conversation at a time, discovered days later from a support
report. Prefer the loud early failure every time.

---

## Part 23 — Tests



Each file tests something different. `test/pgr-machine-flow.test.js` drives the live
filing machine — `pgr-machine.js`, the one a citizen actually reaches — turn by turn:
menu, the complaint-type walk, the boundary walk, institution, description,
attachment, consent, confidentiality, confirm, persist. It asserts on what the
citizen was sent and on the slots handed to `persistComplaint`, so a broken step
shows up as the wrong prompt rather than a stack trace.

It replaces an older table-driven test that drove `machine/pgr.js`, the
step-table generator. Nothing in the production require chain loaded that module, so
the only turn-by-turn test in the repo was exercising code no citizen could reach —
which is why the `receiptCategory` slot bug and the missing boundary `response.ok`
checks went unnoticed. Both now have assertions here.

```js
// test/pgr-machine-flow.test.js - the live machine, one reply per turn
const { outputs } = await runHappyPath({ service: happyPathService() });

const receipt = outputs[outputs.length - 1];
assert.match(receipt, /Categoria: Saúde/);        // top-level category, not the leaf
assert.doesNotMatch(receipt, /FALTA_MEDICAMENTOS/);
```

The rest of the suite covers one seam each, and it is worth knowing the groups
because a change usually lands in exactly one of them.

Dialogue. `question-match-reply.test.js` and `option-label-matching.test.js` check
that a reply matches the label the citizen was shown; `yes-no-labels.test.js` that
the printed word works as well as the number; `error-messages.test.js` that a
validation failure quotes the configured bound rather than a hardcoded ten;
`delayed-prompt.test.js` that a deliberately delayed prompt still reaches the send
queue; `seed-matches-messages.test.js` that the seeded copy says what the machine
says; `offered-locales.test.js` and `localization-init.test.js` that a locale is
offered only when it is complete, and that startup fails rather than serving an
empty one.

Session and persistence. `session-resume.test.js` covers save and resume including
the brick case; `resume-pending-persistance.test.js` that the resume prompt lives
on the row rather than in memory; `invoke-state.test.js` and
`dispatch-stalled-invoke.test.js` the invoke-active state and the stall that
follows it; `persist-queue.test.js` that writes for one citizen land in order;
`dispatch-queueing.test.js` and `send-queue-key.test.js` that a message arriving
mid-turn is queued rather than dropped, and that two citizens never queue behind
each other; `persisted-state-redaction.test.js` that no token survives into the
stored blob; `onboarding-gates.test.js` that a new citizen is not treated as
onboarded; `sandbox-login-flow.test.js` and `service-account-retry.test.js` the two
identity paths.

Authenticity and operations. `twilio-signature.test.js` covers webhook authenticity
including a tampered `From`; `provider-verification.test.js` the shared-secret
providers; `webhook-verification-order.test.js` that verification really is the
first middleware on every citizen-facing route — an ordering mistake would be
invisible otherwise; `whitelist-gate.test.js` that a non-whitelisted number creates
nothing; `telemetry-redaction.test.js` and `privacy.test.js` that no credential and
no full mobile number reach a log or a Kafka topic; `startup-checks.test.js` what
must be set before the service may boot; `status-route.test.js` and
`reminder-sweep.test.js` the two non-conversation routes, the second asserting that
a throwing sweep answers 500 rather than killing the process.

Numbers, media and backends. `mobile-validation.test.js` and `phone-numbers.test.js`
cover the per-tenant rule and the conversions built on it;
`twilio-sender.test.js` and `twilio-media-url.test.js` the outbound address and the
media URL it trusts; `media-types.test.js` and `media-timeout.test.js` what
filestore accepts and what happens when a download hangs;
`value-first-send-errors.test.js` a token endpoint answering HTML;
`inbound-message-types.test.js` that every type the channels emit is accepted
without throwing; `egov-pgr-city.test.js` and `boundary-hierarchy-missing.test.js`
that cities come from the tenant list and that an unregistered hierarchy fails
loudly instead of filing a complaint with no location.

Tests work by replacing modules in Node's cache before requiring the machine, so no
network call happens and backend responses are whatever the test says. One trap: only
the machine file is re-required per test, so any module that captures a service at
load time will hold a stale stub. Inject dependencies instead of importing them.

`test/session-resume.test.js` covers the save-and-resume layer with the repository,
channel and telemetry stubbed out. Its important test asserts the *precondition*
first — that the bad state really does throw — before asserting the fallback catches
it. A test that passes whether or not the code is broken is worse than no test.

`test/offered-locales.test.js` covers which languages the menu offers, including the
case the old implementation got wrong: a locale present in one bundle but missing from
another must not be offered. It stubs both the bundles and the platform locale list,
so it tests the rule rather than whatever the current deployment data happens to be.

Exactly one assertion in the suite checks a nested state path rather than behaviour,
and it is load-bearing. It proves the generated category walk sits where the
hand-written one did, which is what keeps saved conversations resumable. Leave it
alone; if it ever fails, a rename has happened and persisted sessions are about to be
discarded.

Beyond the suite, two techniques are worth knowing. A *probe* is a throwaway script
that drives one part of the machine through many inputs and dumps the transcript,
state and slots as JSON. Capture it before a change, capture it after, diff the two.
It catches differences nobody thought to write an assertion for.

The second is stronger and suits refactors that must not change behaviour at all.
Dump the entire assembled config — every node, with functions collapsed to a marker
so guard and action *presence* is compared — and diff it against the same dump taken
from a `git worktree` at the previous commit. The states-and-transitions split was
gated on that diff being byte-identical across 1,359 lines.

---

## Part 24 — Deleted dead code



Two subtrees used to sit unreachable in `src/`: a location flow that asked for a GPS
pin and fuzzy-matched city and locality names (replaced by the boundary walk), and
onboarding by organisation code (replaced by a single-tenant flow). Alongside them
sat the step-table authoring model — `flow/generate.js`, `join.js`, `layout.js`, the
`*-states.js`/`*-transitions.js` tables and `machine/pgr.js` — superseded by the state
classes in `pgr-machine.js` and `shell-machine.js`.

They were kept on the argument that reading a flow in place beats reconstructing it
from history. That argument lost: a require-graph walk from `src/app.js` showed 14
modules and 2,165 lines that nothing live imported, the repo's only turn-by-turn test
was driving one of them, and two real defects survived review because the tests
covering that area tested unreachable code.

All 14 are deleted, with the three test files that only exercised them. History still
reads them in full if the behaviour is ever wanted — `git log -- <path>` on any of
them — and since they were written for the step-table model, reviving one means
expressing it with the state classes anyway.

To check the same property yourself — that everything under `src/` is reachable from
the entrypoint — walk `require` from `src/app.js` and diff against the file tree.

---

## Part 25 — Recipes



**To add a question**, construct a state in `pgr-machine.js` or `shell-machine.js`,
wire it with `setNext`, add it to the list its group holds, and add its copy to the
matching messages file. Pick the class by what the citizen does: reads (`State`),
types (`AskState`), picks from a list (`QuestionState`), descends a tree
(`WalkState`), waits on a backend (`ProcessingState`).

```js
// 1. pgr-machine.js - declare it alongside the other states
const askSeverity = new QuestionState('severity');

// 2. wire it: the step before now points here, and this one points onward
askDescription.setNext(askSeverity);
askSeverity
  .setPrompt(messages.fileComplaint.severity.question)
  .setOptions(['Low', 'High'])
  .setNext(askForAttachments);

// 3. add it to the group that should hold it
const otherGroup = new Group('other')
  .setStates([askIntitution, askDescription, askSeverity, askForAttachments])
  .setStart('institution');

// 4. flow/pgr-messages.js - the copy
severity: { question: { code: 'chatbot.pgr.severity.question',
                        en_IN: '...', pt_PT: '...' } }

// 5. egov-pgr.js persistComplaint - read the new answer, or it goes nowhere
```

A state left out of every group's `setStates` is simply never compiled, so it will
not appear in the machine at all. Wiring is by object reference, so a misspelled
state name is an undefined variable that throws when the file loads — there is no
way to point a step at a destination that does not exist.

**To change wording**, edit the bundle. If it has a `code` and the deployment has a
translation for that code, the live translation wins — so check there too, or your
edit will appear to do nothing. Adding a locale means adding a key to *every* bundle,
because the language menu only offers locales with complete coverage.

**To store a new answer**, add a `slot` to the step and read it in `persistComplaint`.
Update the slot-contract test to include the new key. Do not write to `context`
directly from a step; that is what `slot` and `set` are for, and the indirection is
what keeps the data flow findable later.

**To add a validation rule**, give the `ask` step a `validate` function. Return `true`
to accept, a message bundle to reject with a specific complaint, or `false` to reject
with the generic retry. Read the bound from configuration rather than writing a
number, and show it in the prompt with a placeholder.

**To call a new backend**, add the method to the appropriate service module, then a
`call` step whose `src` invokes it. Give every failure path a destination — in
practice `#system_error`, which the generator supplies by default. Make the method
`async` even when it could throw synchronously, because a synchronous throw inside an
invoke escapes `onError`.

**To rename a state**, understand that saved conversations reference it by name. The
resume fallback means the citizen gets a fresh session rather than a permanent brick,
but they do lose their place, and telemetry strings change shape at the same time. It
is a deliberate act with a cost rather than a tidy-up.

**When something is stuck**, check three things in order. Does the guard array of the
`process` state have an unconditional last entry? Does every target in that region
resolve? Does every `invoke` have an `onError`? Those three account for essentially
every wedged conversation this codebase has produced, and all three are now generated
or checked.

**Before you commit**, run the suite and walk the flow on the console channel in both
locales. The suite catches structure and regressions; the walk catches wording,
ordering, and the class of problem that only looks wrong when you read a transcript
the way a citizen would. Neither substitutes for the other.

---

## Part 26 — Gotchas worth knowing in advance



Guard order is behaviour. In a walk it decides whether "Go Back" is treated as a
category. In a triplet it decides whether an unrecognised reply retries or wedges.
When you read an `always` array, read it as a sequence of attempts and ask what
happens when none of them match — that last entry is the whole safety net.

```js
// the same shape, read twice. The last entry is the whole difference.
always: [ { target: 'a', cond: f }, { target: 'b', cond: g } ]          // can wedge
always: [ { target: 'a', cond: f }, { target: 'b', cond: g },
          { target: 'error' } ]                                        // cannot
```

`assign` bodies must not accidentally return an object. In v4 a returned object
*replaces* the context wholesale. Writing `assign((c) => c.x = 1)` happens to be
harmless because the result is a primitive, but the same shape with an object literal
would silently wipe the entire conversation. Always use braces, and the generator's
own emitters do exactly that.

Anything a state computes on entry and reads on the *next* message must be stored in
context, because entry actions do not re-run on resume. Anything it computes and uses
within the same turn need not be. Confusing the two produces bugs that appear only
across a deploy or a restart, which is the worst time to find them.

Inside an `always` transition's action, the triggering event is not visible —
`event.data` is `undefined`. If you need the payload of the thing that got you here,
use an entry action. That is what the `effect` field on `say` exists for, and it is
why error payloads reaching `system_error` were silently discarded for a long time.

The reset keyword is the citizen's only universal escape, and it works because of one
rule at the root of the machine rather than anything in the individual states. If you
find yourself adding per-state handling for "hi" or "egov", you are reimplementing it
and will get it subtly wrong somewhere.

`InMemory` is the default repository, so conversations not surviving a restart is
expected rather than broken. Similarly, a script that requires this module without the
deployment's environment variables will silently fall back to defaults — a different
tenant, an unreachable host — and produce answers that look entirely real. Check the
environment before believing a local probe.

Finally: the number "1" means different things in different states, and that is by
design. It is the first menu option, the skip token at the attachment question, and
acceptance at both confirmations. What it means is decided by the grammar of the state
you are in — which is precisely why the position has to be stored, and why this is a
state machine.

---

## Appendix — Map of files

| Path | What it is |
|---|---|
| `src/app.js` | Express server, port, context path, the boot gates |
| `src/env-variables.js` | Every environment variable, with defaults |
| `src/startup-checks.js` | What is fatal, what is merely degraded |
| `src/privacy.js` | Masking, so logs carry no full mobile number |
| `src/phone-numbers.js` | National and international conversions |
| `src/media-types.js` | The content types filestore accepts |
| `src/channel/index.js` | Picks the channel adapter at startup |
| `src/channel/routes/index.js` | The webhook, status, reminder and health endpoints |
| `src/channel/{twilio,console,value-first,kaleyra}.js` | Provider adapters |
| `src/channel/twilio-signature.js` | HMAC verification of a Twilio webhook |
| `src/channel/shared-secret.js` | Authenticity for providers that sign nothing |
| `src/session/session-manager.js` | Orchestrates a turn; the outbound path |
| `src/session/{standard,sandbox}-login-flow.js` | Identity, behind one contract |
| `src/session/chat-service.js` | Builds and drives the machine; persistence |
| `src/session/chat-state.js` | Value wrapper for the persisted blob |
| `src/session/persist-queue.js` | Transition writes, chained per citizen |
| `src/session/invoke-state.js` | Is the machine still working? and the settle wait |
| `src/session/{errors,error-handler}.js` | Typed failures, and what the citizen is told |
| `src/session/telemetry.js` | The Kafka event stream, redacted |
| `src/session/inbound-message-parser.js` | Request to neutral payload; the adapter is injected |
| `src/session/upload-tenant.js` | Which tenant an attachment belongs to |
| `src/session/sandbox-org-tracker.js` | Which organisation a sandbox citizen chose |
| `src/session/repo/` | In-memory and Postgres state storage |
| `src/session/user-service.js` | Mobile number to DIGIT user |
| `src/machine/state-machine.js` | Creates the machine — read this first |
| `src/machine/citizen-service-machine.js` | Joins the shell and filing journeys |
| `src/machine/shell-machine.js` | Onboarding and the chassis |
| `src/machine/pgr-machine.js` | The complaint-filing journey |
| `src/machine/flow/flow-state.js` | Base state class: prompts and branches |
| `src/machine/flow/flow-state-*.js` | One class per kind of step |
| `src/machine/flow/flow-state-compiler.js` | States to XState config |
| `src/machine/flow/{shell,pgr}-messages.js` | Onboarding and filing copy |
| `src/machine/flow/offered-locales.js` | Which languages the menu offers |
| `src/machine/flow/yes-no-options.js` | The one yes/no grammar, shared |
| `src/machine/util/dialog.js` | Prompt, grammar and send primitives |
| `src/machine/util/inbound-*.js` | Transport models for the payload |
| `src/machine/util/localisation-service.js` | Live translations and locales |
| `src/machine/service/egov-pgr.js` | MDMS, boundary, filestore, complaints |
| `src/machine/service/mobile-validation-service.js` | The tenant's mobile rule, from MDMS |
| `src/machine/service/reminders-service.js` | The sweep behind `POST /reminder` |
| `src/machine/service/email-tenant-service.js` | Email to tenant, for sandbox login |
| `test/pgr-machine-flow.test.js` | The live filing flow, turn by turn |
| `test/` (39 files) | One seam each — Part 23 groups them |

**Read in this order on your first day:** `state-machine.js` and
`citizen-service-machine.js` for the assembly, then `pgr-machine.js` for the shape
of a conversation in one screen, then `flow-state.js` and one subclass to see what
a step actually becomes, and `dialog.js` for the primitives underneath all of it.
That is roughly an hour of reading and it covers the entire live flow.
