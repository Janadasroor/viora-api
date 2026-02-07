import fs from 'fs';
import path from 'path';
const __dirname = path.dirname(new URL(import.meta.url).pathname);

const inputFilePath = path.join(__dirname, '../data/users/random-names.txt');

export const getNames = () => {
    // Read the input file
    const fileContent = fs.readFileSync(inputFilePath, 'utf-8');

    // Split the content into lines and filter out empty lines
    const lines = fileContent.split('\n').filter(line => line.trim() !== '');

    // console.log("We have " + lines.length + " lines" );
    // console.log("Sample lines: ", lines.slice(0, 5));
    // Extract names (assuming each line is a name)
    const names = lines.map(line => line.trim());
    return names;

}
getNames();
