export function requireEnv(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`Missing required environment variable ${name}.`);
    }
    return value;
}

export function parseBoolean(value: string | undefined, fallback: boolean): boolean {
    if (value === undefined || value.trim() === "") {
        return fallback;
    }
    return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function parseInteger(value: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(value ?? "", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function normalizeBaseUrl(raw: string, envName: string): string {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        throw new Error(`${envName} is not a valid URL: ${raw}`);
    }
    // Plain http would send the access token in clear text.
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
        throw new Error(`${envName} must use https (http is only allowed for localhost).`);
    }
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}
