import type { SchemaDescriptor } from './types';

/**
 * Descriptor for `tenant.citymodule` — which modules each city runs. The
 * employee home offers a module (e.g. the Dashboard) only to the cities listed
 * in its `tenants` array.
 *
 * Without this descriptor the generic Edit form skips `tenants` (an array of
 * objects), so a module could not be switched on or off for a city from the
 * configurator at all — only `code`, `order`, `active` and `module` showed.
 * The scalar fields stay on the generic loop (and `code` keeps its
 * id-immutability guard); only `tenants` is claimed here.
 */
export const tenantCityModuleDescriptor: SchemaDescriptor = {
  schema: 'tenant.citymodule',
  fields: [
    {
      path: 'tenants',
      label: 'Cities',
      widget: 'json',
      help: 'The cities that get this module, as a JSON list: [{"code": "ke.bomet"}, ...]. A city not listed does not see the module.',
    },
  ],
};
