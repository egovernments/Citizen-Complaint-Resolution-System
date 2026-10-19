export function passwordHelpUrl(baseUrl: string): string {
    const hashIndex = baseUrl.indexOf("#");
    const beforeHash = hashIndex === -1 ? baseUrl : baseUrl.slice(0, hashIndex);
    const hash = hashIndex === -1 ? "" : baseUrl.slice(hashIndex);
    const separator = beforeHash.includes("?") ? "&" : "?";
    return `${beforeHash}${separator}passwordHelp=1${hash}`;
}
