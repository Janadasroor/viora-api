import { getGender } from 'gender-detection-from-name';
import fs from 'fs';
import path from 'path';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

const inputFilePath = path.join(__dirname, '../data/auth/users_profile_data.json');
const outputFilePath = path.join(__dirname, '../data/auth/users_profile_data.json');
const fileContent = fs.readFileSync(inputFilePath, 'utf-8');
const usersData = JSON.parse(fileContent);

const birthDates: string[] = [];
const totalDates = 1500; // number of birth dates you want to generate
const startYear = 1980;
const endYear = 2001;

for (let i = 0; i < totalDates; i++) {
    const year = Math.floor(Math.random() * (endYear - startYear + 1)) + startYear;
    const month = Math.floor(Math.random() * 12) + 1; // 1 to 12
    const day = Math.floor(Math.random() * 28) + 1;   // 1 to 28, safe for all months

    // Format month and day with leading zeros if needed
    const formattedMonth = month < 10 ? `0${month}` : month;
    const formattedDay = day < 10 ? `0${day}` : day;

    birthDates.push(`${year}-${formattedMonth}-${formattedDay}`);
}

console.log(birthDates.length);
console.log(birthDates.slice(0, 2)); // preview first 2 dates

export const detectGender = (name: string) => {
    const gender = getGender(name);
    return gender;
};

export const updateUsersWithGender = () => {
    let i = 0;
    const updatedUsersData = usersData.map((user: any) => {
        const firstName = user.name.split(" ")[0];
        let gender = detectGender(firstName);
        if (gender == "unknown") {
            gender = "male";
        }
        return { ...user, gender, birthDate: birthDates[i++] };
    });

    fs.writeFileSync(outputFilePath, JSON.stringify(updatedUsersData, null, 2), 'utf-8');
    console.log('Users data updated with gender field successfully.');
};

updateUsersWithGender();
