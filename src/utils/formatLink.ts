
export function formatLink(fileName: string) {
    const defaultHost = 'http://localhost:3003';
    if (fileName.endsWith('.mp4') || fileName.endsWith('.mkv') || fileName.endsWith('.webm')) {
        return `${defaultHost}/videos/${fileName}`;
    } else if (fileName.endsWith('.mp3') || fileName.endsWith('.wav') || fileName.endsWith('.ogg')) {
        return `${defaultHost}/audios/${fileName}`;
    }
    return `${defaultHost}/images/${fileName}`
}

export function getCurrentHost() {
    return `http://localhost:3003`
}