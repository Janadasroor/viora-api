/**
 * Extracts unique usernames mentioned in a text string.
 * Mentions are identified by the "@" symbol followed by word characters.
 * 
 * @param text The text to parse for mentions
 * @returns An array of unique usernames found in the text (without the @ symbol)
 */
export function extractMentions(text: string): string[] {
    if (!text) return [];

    // Match @username pattern preceded by start of string or whitespace
    // (?:^|\s) matches start of line or whitespace (non-capturing)
    // @ matches literal @
    // (\w+) matches username (captured)
    const mentionRegex = /(?:^|\s)@(\w+)/g;

    const matches = text.matchAll(mentionRegex);

    // Extract usernames from capture group 1
    const usernames = Array.from(matches, m => m[1]).filter((u): u is string => !!u);

    return [...new Set(usernames)];
}
