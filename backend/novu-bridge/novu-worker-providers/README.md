# DIGIT providers for the Novu worker

SMS providers that Novu v2.3.0 does not ship (SMSCountry, Jasmin, Ozeki), added to the
**stock** `ghcr.io/novuhq/novu/worker:2.3.0` image at start-up. No fork, no custom build.

The deploy mounts this directory read-only at `/opt/digit-novu-providers` and starts the
worker with `NODE_OPTIONS=--require /opt/digit-novu-providers/register.js` and
`DIGIT_NOVU_PROVIDERS=required` (register in every process but the image's dotenv helper,
not only in `apps/worker/dist/main.js`). The worker logs
`[digit-novu-providers] SMS providers registered ...` on success, and refuses to boot if a
provider fails to load or the image is not a verified Novu version. A process that skips
registration says so on stderr.

```bash
./run-tests.sh                                                   # inside the stock image
NOVU_TEST_IMAGE=ghcr.io/novuhq/novu/worker:<ver> ./run-tests.sh  # before a Novu bump
```

A change here must be copied to
`devops/deploy-as-code/charts/backbone-services/novu/files/novu-worker-providers/`
(helm reads only inside the chart); a static contract test fails until it is.

How it works, how it is deployed, upgrading Novu and adding a provider:
[docs/releases/2.20/notifications/providers.md](../../../docs/releases/2.20/notifications/providers.md#digits-worker-providers).
