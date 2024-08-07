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
    try {
        sendUpdate(`Fetching chapter from ${url}`);
        const response = await axios.get(url, { headers });
        const $ = cheerio.load(response.data);

        const chapterTitle = $('.chapter-title').text().trim() || 'Untitled Chapter';
        const chapterContainer = $('#chapter-container');
        
        if (!chapterContainer.length) {
            sendUpdate(`Could not find the chapter content in ${url}`);
            return [null, null];
        }

        const chapterText = `<h1>${chapterTitle}</h1>\n${chapterContainer.html()}`;
        sendUpdate(`Successfully fetched chapter: "${chapterTitle}"`);

        const nextChapterLink = $('a[rel="next"]');
        const nextChapterUrl = nextChapterLink.length ? new URL(nextChapterLink.attr('href'), url).toString() : null;

        return [chapterText, nextChapterUrl];
    } catch (error) {
        sendUpdate(`Failed to fetch chapter from ${url}: ${error}`);
        return [null, null];
    }
}

function saveChapter(content, chapterNumber, directory, sendUpdate) {
    const filename = path.join("public/"+directory, `chapter_${chapterNumber}.html`);
    fs.writeFileSync(filename, content, 'utf-8');
    sendUpdate(`Saved Chapter ${chapterNumber} in ${directory}`);
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


    // prepend chapters with a title page that uses the cover image too
    chapters.unshift(
    { 
        title: `${title} - ${author}`, 
        data: `${title} <img src="cover.jpeg" style="width: 100%; object-fit: cover;">${author}` 
    }
    );
    
    // Step 4: Create options object
    const options = {
        title: title,
        author: author,
        output: path.join(dirPath, `${title}.epub`),
        cover: path.join(dirPath, 'cover.jpg'),
        content: chapters, // Ensure this is the chapters array
    };

    try {
        // Step 5: Generate EPUB and handle the resulting buffer
        new epub(options).promise.then(() => console.log('Done'));
        sendUpdate(`ePub created successfully: <a href="/${directory}/${title}.epub" download>Download Here</a>`);
    } catch (err) {
        // Handle and log errors
        console.error("Failed to generate Ebook because of ", err);
        sendUpdate(`Failed to create ePub: ${err.message}`);
    }
}


async function downloadChapters(title, author, startUrl, chapterRange, coverUrl, sendUpdate) {
    let url = startUrl;
    let chapterNumber = 1;
    const [startChapter, endChapter] = chapterRange ? chapterRange.split('-').map(Number) : [1, Infinity];
    const directory = title.replace(' ', '_');
    
    if (!fs.existsSync("public/" + directory)) {
        fs.mkdirSync("public/" + directory);
    }

    while (fs.existsSync(path.join(directory, `chapter_${chapterNumber}.html`))) {
        chapterNumber += 1;
    }

    if (chapterNumber > 1) {
        chapterNumber -= 1;
        const lastFile = fs.readFileSync(path.join(directory, `chapter_${chapterNumber}.html`), 'utf-8');
        const $ = cheerio.load(lastFile);
        const nextChapterLink = $('a[rel="next"]');
        if (nextChapterLink.length) {
            url = new URL(nextChapterLink.attr('href'), startUrl).toString();
        } else {
            sendUpdate("No next chapter link found in the last downloaded chapter. Exiting...");
            return;
        }
    }

    while (url && chapterNumber <= endChapter) {
        if (chapterNumber >= startChapter) {
            sendUpdate(`Fetching Chapter ${chapterNumber} from ${url}`);
            const [chapterText, nextUrl] = await fetchChapter(url, sendUpdate);
            if (chapterText) {
                saveChapter(chapterText, chapterNumber, directory, sendUpdate);
            } else {
                sendUpdate("Failed to fetch chapter content. Exiting...");
                break;
            }

            if (!nextUrl) {
                sendUpdate("No next chapter found. Exiting...");
                break;
            }

            url = nextUrl;
        } else {
            sendUpdate(`Skipping Chapter ${chapterNumber}`);
        }
        
        chapterNumber += 1;
    }

    await downloadCoverImage(coverUrl, directory, sendUpdate);
    await createEpub(title, author, directory, sendUpdate);
}

async function getTitlePage(url, sendUpdate) {
    try {
        const response = await axios.get(url, { headers });
        const $ = cheerio.load(response.data);
        const title = $('h1.novel-title.text2row').text().trim();
        const author = $('div.author').text().trim();

        // need root url in case of relative links
        const rootUrl = new URL(url).origin;
        const startUrl = new URL($('a#readchapterbtn').attr('href'), rootUrl).toString();
        const coverUrl = $('figure.cover img').attr('data-src');
        // chapterCount comes from the first span in the following: <div class="header-stats"><span><strong><i class="icon-book-open"></i> 192</strong><small>Chapters</small></span><span><strong><i class="icon-eye"></i> 138K</strong><small>Views</small></span><span><strong><i class="icon-bookmark"></i> 2.21K</strong><small>Bookmarked</small></span><span><strong class="ongoing">Ongoing</strong><small>Status</small></span></div>
        const chapterCount = $('div.header-stats span strong').text().trim().split(' ')[0];

        sendUpdate(`Successfully fetched title page: ${title}, ${author}, ${startUrl}, ${coverUrl}`);
        return [title, author, startUrl, coverUrl, chapterCount];
    } catch (error) {
        sendUpdate(`Failed to fetch title page: ${error}`);
        return [null, null, null, null];
    }
}

app.get('/', (req, res) => {
    res.render('index');
});

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
        getTitlePage(startUrl, sendUpdate).then(([title, author, ch1, coverUrl, totalChapters]) => {
            if (title) {
                // count how many chapters are in the existing folder (if it exists). If totalChapters == how many chapters exist already, don't download anything.
                const directory = title.replace(' ', '_');

                if (!fs.existsSync("public/" + directory)) {
                    fs.mkdirSync("public/" + directory);
                }

                const existingFiles = fs.readdirSync(path.join("public", directory));
                const existingChapters = existingFiles.filter(file => file.startsWith('chapter_') && file.endsWith('.html')).length;
                if (existingChapters >= totalChapters) {
                    sendUpdate(`Up to date. Download here: <a href="/public/${directory}/${title}.epub">${title}</a>`);
                    return;
                }
                
                downloadChapters(title, author, ch1,null, coverUrl, sendUpdate).then(() => {
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
