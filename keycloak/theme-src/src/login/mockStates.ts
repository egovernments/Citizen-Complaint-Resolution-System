/**
 * Field-level error states for the dev server and the tests.
 *
 * Keycloak hands pages a `messagesPerField` object rather than a plain map, so
 * a mocked error has to be installed the same way the server would present it.
 */
export function withFieldErrors<T extends { messagesPerField: unknown }>(
    kcContext: T,
    errors: Record<string, string>
): T {
    const messagesPerField = {
        printIfExists: <R,>(fieldName: string, text: R) =>
            errors[fieldName] !== undefined ? text : undefined,
        existsError: (...fieldNames: string[]) =>
            fieldNames.some(fieldName => errors[fieldName] !== undefined),
        get: (fieldName: string) => errors[fieldName] ?? "",
        exists: (fieldName: string) => errors[fieldName] !== undefined,
        getFirstError: (...fieldNames: string[]) => {
            for (const fieldName of fieldNames) {
                const error = errors[fieldName];
                if (error !== undefined) {
                    return error;
                }
            }
            return "";
        }
    };
    return { ...kcContext, messagesPerField } as T;
}
