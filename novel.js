const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const fs = require('fs');
const { URL } = require('url');
const WebSocket = require('ws');
const { exit } = require('process');
const epub = require('epub-gen')

const app = express();
const port = 3000;

app.use(express.json());
app.use(express.static('public'));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/70.0.3538.77 Safari/537.36'
};

async function fetchChapter(url, sendUpdate) {
    if(url !== "javascript:;") {
        try {
            const response = await axios.get(url, { headers });
            const $ = cheerio.load(response.data);

            if(url.includes("royalroad")) {
                const chapterTitle = $('body > div.page-container > div > div > div > div > div.row.fic-header.margin-bottom-40 > div > div.col-md-5.col-lg-6.col-md-offset-1.text-center.md-text-left > h1').text().trim();
                const chapterContainer = $('.chapter-content')
                const nextChapterLink = $('div.portlet-body > div.row.nav-buttons > div.col-xs-6.col-md-4.col-md-offset-4.col-lg-3.col-lg-offset-6 > a').attr('href');

                if(nextChapterLink)
                {
                    const nextChapterUrl = new URL(nextChapterLink, url).toString();
                    const chapterText = `<h1>${chapterTitle}</h1>\n${chapterContainer.html()}`;
                    sendUpdate(`Successfully fetched chapter and next: "${chapterTitle}"`);

                    return [chapterText, nextChapterUrl];
                } else {
                    const chapterText = `<h1>${chapterTitle}</h1>\n${chapterContainer.html()}`;
                    sendUpdate(`Successfully fetched chapter: "${chapterTitle}"`);
                    return [chapterText, null];
                }
            } else {
                const chapterTitle = $('.chapter-title').text().trim() || 'Untitled Chapter';
                const chapterContainer = $('#chapter-container');
                const nextChapterLink = $('a[rel="next"]').attr('href');
                console.log(nextChapterLink);
                const nextChapterUrl = nextChapterLink.length ? new URL(nextChapterLink, url).toString() : null;                

                const chapterText = `<h1>${chapterTitle}</h1>\n${chapterContainer.html()}`;

                sendUpdate(`Successfully fetched chapter: "${chapterTitle}"`);

                return [chapterText, nextChapterUrl];
            }

        } catch (error) {
            sendUpdate(`Failed to fetch chapter content from ${url}: ${error}`);
            return [null, null];
        }
    } else {
        sendUpdate("Downloading Chapters Completed...");
        return [null, null];
    }
}

function saveChapter(content, chapterNumber, directory, sendUpdate) {
    const filename = path.join("public", directory, `chapter_${chapterNumber}.html`);
    
    try {
        // Ensure the directory exists.
        if (!fs.existsSync(path.join("public", directory))) {
            fs.mkdirSync(path.join("public", directory), { recursive: true });
        }
        
        fs.writeFileSync(filename, content, 'utf-8');
        sendUpdate(`Chapter ${chapterNumber} saved successfully in ${directory}.`);
    } catch (error) {
        sendUpdate(`Failed to save chapter ${chapterNumber}: ${error.message}`);
        return;
    }
}

async function downloadCoverImage(coverUrl, directory, sendUpdate) {
    if (!coverUrl) {
        sendUpdate('No cover image URL provided. Skipping cover image download.');
        return;
    }

    try {
        sendUpdate(`Downloading cover image from ${coverUrl}`);
        const response = await axios.get(coverUrl, {
            responseType: 'arraybuffer',
            headers: {
                'Content-Type': 'image/jpeg',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/70.0.3538.77 Safari/537.36'
            }
        });
        const coverPath = path.join('public/' + directory, 'cover.jpg');
        fs.writeFileSync(coverPath, response.data);
        sendUpdate('Cover image downloaded successfully.');
    } catch (error) {
        sendUpdate(`Failed to download cover image: ${error.message}`);
    }
}

async function createEpub(title, author, directory, sendUpdate) {
    // Step 1: Read chapter files from directory
    const dirPath = path.join("public", directory);
    const files = fs.readdirSync(dirPath).filter(file => file.startsWith('chapter_') && file.endsWith('.html'));
    
    if (!files.length) {
        sendUpdate('No chapter files found.');
        return;
    }

    // Step 2: Sort chapter files
    const sortedFiles = files.sort((a, b) => parseInt(a.split('_')[1]) - parseInt(b.split('_')[1]));
    
    // Step 3: Extract content and titles from chapter files
    const chapters = sortedFiles.map((file, index) => {
        const filePath = path.join(dirPath, file);
        // content needs to remove the first h1 tag
        const content = fs.readFileSync(filePath, 'utf-8');
        const $ = cheerio.load(content);
        const chapterTitle = $('h1').first().text() || `Chapter ${index + 1}`;
        // we need to remove the h1 tag and it's contents from the content
        return { title: chapterTitle, data: content.replace(/<h1.*?>(.*?)<\/h1>/, '') };
    });

    
    // Step 4: Create options object
    const options = {
        title: title,
        author: author,
        output: path.join(dirPath, `${title.replace(/\s+/g, '_')}.epub`),
        cover: path.join(dirPath, 'cover.jpg'),
        content: chapters, // Ensure this is the chapters array
    };

    try {
        // Step 5: Generate EPUB and handle the resulting buffer
        new epub(options).promise.then(() => console.log('Done'));
        // remove lock
        // delete /public/directory/fetch.lock after generating epub
        
        if(fs.existsSync(path.join("public", directory, "fetch.lock"))) {
            fs.unlinkSync(path.join("public", directory, "fetch.lock"));            
        }
        sendUpdate(`ePub created successfully: <a href="/${title}/${title}.epub" download>Download Here</a>`);

    } catch (err) {
        // Handle and log errors
        console.error("Failed to generate Ebook because of ", err);
        sendUpdate(`Failed to create ePub: ${err.message}`);
    }
}

// Utility to extract chapter number from chapter text
function extractChapterNumber(chapterText, directory) {
    const files = fs.readdirSync(path.join("public", directory));
    const existingChapters = files.filter(file => file.startsWith('chapter_') && file.endsWith('.html')).length;
    return existingChapters + 1;
}


async function downloadChapters(title, author, startUrl, coverUrl, sendUpdate, skipFirstChapter = false) {
    let url = startUrl;

    if (!sendUpdate) {
        sendUpdate = message => { console.log(message); };
    }

    const directory = title.replace(/\s+/g, '_');

    if (!fs.existsSync(path.join("public", directory))) {
        fs.mkdirSync(path.join("public", directory));
    }

    const dirPath = path.join("public", directory);
    let chapterNumber = 1; // Default to start at Chapter 1

    // Retrieve existing chapters sorted by chapter number
    const existingChapters = fs.readdirSync(dirPath)
        .filter(file => file.startsWith('chapter_') && file.endsWith('.html'))
        .sort((a, b) => parseInt(a.split('_')[1]) - parseInt(b.split('_')[1]));

    if (existingChapters.length > 0) {
        const lastChapterFile = existingChapters[existingChapters.length - 1];
        chapterNumber = parseInt(lastChapterFile.split('_')[1]) + 1;  // Start with the next chapter number

        // Read the content of the last downloaded chapter
        const lastChapterContent = fs.readFileSync(path.join(dirPath, lastChapterFile), 'utf-8');
        const $last = cheerio.load(lastChapterContent);
        const lastChapterTitle = $last('h1').first().text().trim();
        sendUpdate(`Last downloaded chapter title: "${lastChapterTitle}"`);

        // Fetch just the title/text from the starting URL without saving it
        const [currentChapterText, nextUrl] = await fetchChapter(url, sendUpdate); 
        const $current = cheerio.load(currentChapterText);
        const currentChapterTitle = $current('h1').first().text().trim();
        
        // If the last chapter and current startUrl chapter titles match, skip the first chapter
        if (lastChapterTitle === currentChapterTitle) {
            sendUpdate(`The chapter from startUrl "${url}" matches the last downloaded chapter. Skipping this chapter.`);
            url = nextUrl;  // Move to the next chapter URL
        } else {
            sendUpdate(`The chapter from startUrl "${url}" differs from the last downloaded chapter. Restarting from this chapter.`);
            // Do not change the url, proceed to download this chapter again.
            chapterNumber--;  // Adjust the chapter number to overwrite or continue correctly
        }
    }

    while (url) {
        const books = JSON.parse(fs.readFileSync('books.json', 'utf8'));
        const book = books.find(book => book.title === title);

        if (book && url !== "javascript:;") {
            book.ch1 = url;
            fs.writeFileSync('books.json', JSON.stringify(books, null, 2));
        }

        const [chapterText, nextUrl] = await fetchChapter(url, sendUpdate);

        if (!chapterText) {
            sendUpdate("Failed to fetch chapter content. Exiting...");
            break;
        }

        const currentChapterNumber = chapterNumber;

        saveChapter(chapterText, currentChapterNumber, directory, sendUpdate);

        if (!nextUrl) {
            sendUpdate("No next chapter found. Exiting...");
            break;
        }

        url = nextUrl;  // Proceed to the next chapter's URL
        chapterNumber += 1;  // Increment the chapter number correctly
    }

    await downloadCoverImage(coverUrl, directory, sendUpdate);
    await createEpub(title, author, directory, sendUpdate);
}

async function getTitlePage(url, sendUpdate) {

    if (url.includes("royalroad")) {
        try {
            const response = await axios.get(url, { headers });
            const $ = cheerio.load(response.data);
            const title = $('div.page-content-inner > div > div.row.fic-header > div.col-md-5.col-lg-6.text-center.md-text-left.fic-title > div > h1').text().trim();
            const author = $('div.page-content-inner > div > div.row.fic-header > div.col-md-5.col-lg-6.text-center.md-text-left.fic-title > div > h4 > span:nth-child(2)').text().trim();
            sendUpdate(`Successfully fetched title page: ${title}, ${author}`);

            const rootUrl = new URL(url).origin;
            const status = $('div.page-content-inner > div > div.fiction.row > div > div.fiction-info > div.portlet.light.row > div.col-md-8 > div.margin-bottom-10 > span:nth-child(2)').text().trim();
            if(status=="STUB")
            {
                sendUpdate("This book seems to have chapters missing due to the author removing them...this could mean that they removed them in adherance to 3rd party requirements.")
                return [null, null, null, null, null, null, null];
            }
            const startUrl = new URL($('div.page-content-inner > div > div.row.fic-header > div.col-md-4.col-lg-3.fic-buttons.text-center.md-text-left > a').attr('href'), rootUrl).toString();
            const coverUrl = $('body > div.page-container > div > div > div > div.page-content-inner > div > div.row.fic-header > div.col-md-3.text-center.cover-col > div > img').attr('src');
            const chapterCount = $('div.page-content-inner > div > div.fiction.row > div > div.fiction-info > div:nth-child(5) > div.portlet-title > div.actions > span').text().replace(" Chapters", "").trim();
            
            //sendUpdate(`title: ${title}, author: ${author}, url: ${url}, coverUrl: ${coverUrl}, chapterCount: ${chapterCount}, status: ${status}, startUrl: ${startUrl}`);

            return [title, author, startUrl, coverUrl, chapterCount, status, url];
        } catch (error) {
            sendUpdate(`Failed to fetch title page: ${error}`);
            return [null, null, null];
        }
    } else {
        try {
            const response = await axios.get(url, { headers });
            const $ = cheerio.load(response.data);
            const title = $('h1.novel-title.text2row').text().trim();
            const author = $('div.author').text().replace("Author:", "").replace(/\n+/g, '').trim();

            const rootUrl = new URL(url).origin;
            const startUrl = new URL($('a#readchapterbtn').attr('href'), rootUrl).toString();
            const coverUrl = $('figure.cover img').attr('data-src');
            const chapterCount = $('div.header-stats span strong').text().trim().split(' ')[0];
            const status = $('div.header-stats span:last-child').text().replace("Status", "").trim();

            //sendUpdate(`Successfully fetched title page: ${title}, ${author}, ${startUrl}, ${coverUrl}, ${chapterCount}, ${status}`);
            return [title, author, startUrl, coverUrl, chapterCount, status, url];
        } catch (error) {
            sendUpdate(`Failed to fetch title page: ${error}`);
            return [null, null, null, null, null, null];
        }
    }
}

app.get('/', (req, res) => {
    res.render('index');
});

app.get("/books", (req, res) => {
    // get books from books.json
    fs.readFile('books.json', 'utf8', (err, data) => {
        if (err) {
            console.error(err);
            return;
        }
        // sort books by updated date
        const books = JSON.parse(data);
        books.sort((a, b) => new Date(b.updated) - new Date(a.updated));
        res.status(200).json(books);
    });
});

app.use("/public", express.static("public"));

app.get("/cron", (req, res) => {

    const sendUpdate = (message) => {
        console.log(message);
    };
    // This is to check books.json for any status of "ongoing" for any new chapters by looking at the ch1 url, then run downloadChapters function
    fs.readFile('books.json', 'utf8', (err, data) => {
        if (err) {
            console.error(err);
            return;
        }
        const books = JSON.parse(data);
        books.forEach(book => {
            // book.status could be Ongoing or ONGOING, so let's lowercase the string. 
            if (book.status.toLowerCase() == "ongoing") {
                console.log(`Checking ${book.title} for new chapters...`);
                // count number of files in the directory (replace spaces with underscores), and if the count is less than the total chapters, then run downloadChapters
                const bookTitle = book.title.replace(/\s+/g, '_');

                const dirPath = path.join("public", bookTitle);
                // check if directory exists
                if (!fs.existsSync(dirPath)) {
                    fs.mkdirSync(dirPath);
                }
                const files = fs.readdirSync(dirPath).filter(file => file.startsWith('chapter_') && file.endsWith('.html'));
                // update totalChapters in books.json

                // get new totalChapters from getTitlePage
                getTitlePage(book.url, sendUpdate).then(([title, author, startUrl, coverUrl, totalChapters, status, url]) => {
                    // update books.json with new chapter count, just in case it does change
                    if(book.totalChapters != totalChapters) {
                        const date = new Date();
                        const year = date.getFullYear();
                        const month = String(date.getMonth() + 1).padStart(2, '0');
                        const day = String(date.getDate()).padStart(2, '0');
                        const updatedDate = `${year}-${month}-${day}`;
    
                        book.totalChapters = totalChapters;
                        book.updated = updatedDate
                        fs.writeFileSync('books.json', JSON.stringify(books, null, 2));
                    }
                    console.log(`${book.title}: \n Found ${files.length} files.\n Total chapters: ${book.totalChapters}\n`);
                    if (files.length < book.totalChapters) {

                        downloadChapters(book.title, book.author, book.ch1, book.coverUrl, null, true);

                    } else {
                        console.log(`Skipping ${book.title} because it is up to date.`);
                    }
    
                })
                //downloadChapters(book.title, book.author, book.ch1, null, book.coverUrl, null);
            } else {
                console.log(`Skipping ${book.title} because it is not ongoing.`);
            }
        })
    })

    res.status(200).json({ message: 'Cron job done' });
})

app.post('/download', (req, res) => {
    const { startUrl } = req.body;
    const clientId = req.body.clientId;
    const client = clients.get(clientId);

    if (client) {
        const sendUpdate = (message) => {
            client.send(JSON.stringify({ message }));
        };

        // grab title page
        sendUpdate('Grabbing title page...');
        getTitlePage(startUrl, sendUpdate).then(([title, author, ch1, coverUrl, totalChapters, status, url]) => {
            if (title) {
                //client.send(JSON.stringify({ bookInfo: { title, author, coverUrl, totalChapters, ch1, status, url } }));
                // count how many chapters are in the existing folder (if it exists). If totalChapters == how many chapters exist already, don't download anything.
                const directory = title.replace(/\s+/g, '_');  // Replace spaces with underscores

                if (!fs.existsSync("public/" + directory)) {
                    fs.mkdirSync("public/" + directory);
                }

                // check books.json to see if the book already exists, if not, add the title, author, coverUrl, totalChapters, and ch1 to the books.json
                // confirm books.json exists, if not create it.
                if (!fs.existsSync('books.json')) {
                    fs.writeFileSync('books.json', '[]');
                }

                const books = JSON.parse(fs.readFileSync('books.json', 'utf8'));
                const existingBook = books.find(book => book.title === title);
                if (!existingBook) {
                    const date = new Date();
                    const year = date.getFullYear();
                    const month = String(date.getMonth() + 1).padStart(2, '0');
                    const day = String(date.getDate()).padStart(2, '0');
                    const updated = `${year}-${month}-${day}`;
                    books.push({ title, author, coverUrl, totalChapters, ch1, status, url, updated });
                    fs.writeFileSync('books.json', JSON.stringify(books, null, 2));
                } else {
                    if(existingBook.ch1 !== ch1) {
                        ch1 = existingBook.ch1;
                    }
                }

                const existingFiles = fs.readdirSync(path.join("public", directory));
                const existingChapters = existingFiles.filter(file => file.startsWith('chapter_') && file.endsWith('.html')).length;
                if (existingChapters >= totalChapters) {
                    // check to see if epub exists, if not compile it
                    if (!fs.existsSync(path.join("public", directory, `${title}.epub`))) {
                        // confirm if cover exists
                        if (!fs.existsSync(path.join("public", directory, "cover.jpg"))) {
                            downloadCoverImage(coverUrl, directory, sendUpdate);
                            createEpub(title, author, directory, sendUpdate).then(() => {
                                sendUpdate(`Up to date. Download here: <a href="/public/${directory}/${directory}.epub">${title}</a>`);
                            });
                        } else {
                            createEpub(title, author, directory, sendUpdate).then(() => {
                                sendUpdate(`Up to date. Download here: <a href="/public/${directory}/${directory}.epub">${title}</a>`);
                            });
                        }
                    } else {
                        sendUpdate(`Up to date. Download here: <a href="/public/${directory}/${directory}.epub">${title}</a>`);
                    }
                    return;
                }

                downloadChapters(title, author, ch1, coverUrl, sendUpdate).then(() => {
                    sendUpdate('Process Complete');
                });
            } else {
                sendUpdate('Failed to fetch title page. Exiting...');
                console.error('Failed to fetch title page. Exiting...');
            }
        })
        /*  */
    }

    res.status(200).json({ message: 'Download started' });
});



const server = app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});

const wss = new WebSocket.Server({ server });
const clients = new Map();

wss.on('connection', (ws) => {
    const clientId = Date.now().toString();
    clients.set(clientId, ws);
    ws.send(JSON.stringify({ clientId }));

    ws.on('close', () => {
        clients.delete(clientId);
    });
});
