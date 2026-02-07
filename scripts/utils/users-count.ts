import fs from 'fs';
import path from 'path';
const __dirname = path.dirname(new URL(import.meta.url).pathname);

const inputFilePath = path.join(__dirname, '../data/auth/users_profile_data.json');

export const getUsersCount = () => {
    // Read the input file
    const fileContent = fs.readFileSync(inputFilePath, 'utf-8');
    const usersData = JSON.parse(fileContent);
    console.log("We have " + usersData.length + " users");
    console.log("First 5 users:", usersData.slice(0, 5).map((user: any) => user.username));
    return usersData.length;

}
getUsersCount();
