# Wedding DJ Assistant

Build a simple no-login web app called “Wedding Dance Floor List Builder.”

The app should help a wedding DJ upload client song lists and generate three ready-to-use CSV files for a wedding dance floor:

1. Warm Up

2. Transition

3. Peak

The app should be a single-page tool that anyone with the link can access. No login, no account creation, no database required for the MVP. Uploaded files should only be processed in the browser and should not be stored permanently.

Core App Workflow:

1. Upload Files

Allow the user to upload multiple CSV or TXT files at the same time.

Accepted file types:

- .csv

- .txt

The app should parse uploaded files and extract songs into a unified list.

The app should support common CSV column names such as:

- Artist

- Artists

- Song

- Track

- Track Name

- Title

- Name

If the uploaded file is a TXT file, support lines formatted like:

- Artist - Song

- Song - Artist

- Artist, Song

- Song, Artist

After upload, show a preview table where the user can review and edit the detected Artist and Song fields before generating lists.

The final exported files must only include two columns:

Artist, Song

No other columns should be included in the exported CSV files.

2. Dance Floor Length

Add a user input for total open dance floor length.

The user should be able to enter dance floor length in hours, including decimals:

Examples:

- 3

- 3.5

- 4

The app should break the dance floor into three sections:

- Warm Up = first third

- Transition = second third

- Peak = final third

Display the approximate time length of each section.

Example:

For 3.5 hours:

- Warm Up: about 70 minutes

- Transition: about 70 minutes

- Peak: about 70 minutes

3. Music Preference Inputs

Add text inputs where the user can enter:

Favorite artists:

Example:

Pitbull, Flo Rida, Rihanna, Lady Gaga, David Guetta

Favorite genres:

Example:

Pop, EDM, Pop Punk, Alternative Rock, Rock

Preferred decades:

Use checkboxes:

- 1960s

- 1970s

- 1980s

- 1990s

- 2000s

- 2010s

- 2020s

Also include a text area for additional notes:

Example:

“Focus mostly on songs from 2000 and newer. Keep the first hour friendly for all ages. Peak hour should be high-energy modern music.”

4. Add Additional Songs Toggle

Include a toggle option:

“Add additional songs based on artist, genre, and decade preferences”

Options:

- Off: Only use songs provided in uploaded files

- On: Include all uploaded songs, then add additional matching songs based on the user’s preferred artists, genres, decades, and notes

Important rules:

- Never remove uploaded songs.

- Never leave out uploaded songs.

- If the toggle is off, only uploaded songs should appear in the exported lists.

- If the toggle is on, uploaded songs should still all be included, and additional songs can be added to improve the flow.

For the MVP, if external AI/song recommendation integration is not configured, create a built-in curated song library that includes common wedding dance floor songs across pop, EDM, pop punk, rock, alternative rock, hip hop, disco, funk, and throwback genres. Each song in the internal library should have:

- Artist

- Song

- Genre

- Decade

- Energy score from 1 to 10

- Recommended section: Warm Up, Transition, or Peak

5. Sorting Logic

Create a simple scoring system to assign each song to Warm Up, Transition, or Peak.

Warm Up:

- First third of the dance floor

- Energy range: 5 to 7

- More all-ages friendly

- Good for early open dancing

- Can include older songs, singalongs, pop, disco, funk, rock, and familiar throwbacks

Transition:

- Second third of the dance floor

- Energy range: 6 to 8

- More modern

- Bridges familiar songs into stronger dance-floor tracks

- Can include pop, EDM, pop punk, rock, alternative, and 2000s/2010s songs

Peak:

- Final third of the dance floor

- Energy range: 8 to 10

- Highest-energy songs

- Mostly modern songs

- Strong dance floor songs, party tracks, pop, EDM, pop punk, rock, and singalong closers

If a song does not have metadata, estimate its placement using artist, genre, decade, and title where possible.

When only uploaded songs are used, distribute every uploaded song across the three sections as intelligently as possible.

When additional songs are enabled, add songs that match:

- Preferred artists

- Preferred genres

- Preferred decades

- User notes

- Overall wedding dance floor usability

Avoid duplicates. Detect duplicates even if casing or punctuation is different.

6. Export CSV Files

Create export buttons for:

- Export Warm Up CSV

- Export Transition CSV

- Export Peak CSV

- Export All Three as ZIP

Each individual CSV must only contain:

Artist, Song

No energy score.

No genre.

No notes.

No section name.

No source field.

The ZIP file should contain:

- warm-up.csv

- transition.csv

- peak.csv

Optional: Also include a combined reference file named combined-dance-floor-lists.csv, but only if the user checks an option for it.

The combined reference file can include:

Section, Artist, Song

But the three main DJ import CSV files must only include:

Artist, Song

7. User Interface

The design should be clean, simple, and professional.

The page sections should be:

Header:

“Wedding Dance Floor List Builder”

Subtitle:

“Upload client playlists, choose the vibe, and export DJ-ready CSV files.”

Step 1: Upload Song Lists

- Drag and drop upload area

- Multiple file upload

- CSV and TXT accepted

Step 2: Review Imported Songs

- Editable table with Artist and Song columns

- Ability to delete a row

- Ability to manually add a row

- Duplicate warning

Step 3: Enter Dance Floor Details

- Dance floor length input

- Favorite artists input

- Favorite genres input

- Decade checkboxes

- Additional notes textarea

Step 4: Song Expansion Option

- Toggle: Add additional songs

- Helper text:

“When turned off, the app will only use songs from the uploaded files.”

Step 5: Generate Lists

- Button: Generate Dance Floor Lists

Step 6: Review and Export

Show three tabs or columns:

- Warm Up

- Transition

- Peak

Each section should show a table with Artist and Song only.

Each section should have an export button.

There should also be a button to download all three CSV files as a ZIP.

8. Data Handling

Do not require user login.

Do not permanently save files.

Do not store uploaded songs in a database.

Use browser state/local memory only.

The app should reset when the page is refreshed unless the user chooses to download the files.

9. Technical Requirements

Use React.

Use TypeScript.

Use Tailwind CSS.

Use a clean component structure.

Use Papa Parse or another reliable CSV parser for CSV import/export.

Use JSZip for ZIP export.

Use a simple client-side data model.

Create clear helper functions for:

- Parsing uploaded CSV/TXT files

- Normalizing duplicate detection

- Assigning songs to Warm Up, Transition, or Peak

- Generating CSV files

- Generating ZIP file

10. Important Output Rule

The exported Warm Up, Transition, and Peak CSV files must have exactly two columns:

Artist, Song

No extra metadata should be included.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://dancefloor-builder.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/7afbfd53-f801-46a5-b9fd-99f89f38b576).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
