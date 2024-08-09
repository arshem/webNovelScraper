# WebNovelScraper

WebNovelScraper is a Node.js application to automatically download chapters from web novels as they become available and compile them into an EPUB format.

## Supported Sites:
- webnovelpub.pro
- webnovelpub.co
- lightnovelworld.co
- lightnovelworld.com
- lightnovelhub.org
- lightnovelpub.com
- royalroad.com

## Features

- Fetches chapters from a given starting URL.
- Downloads cover image if available.
- Compiles fetched chapters into an EPUB.
- Real-time updates via WebSocket.
- Simple Web UI for starting and monitoring download progress.
- Fetches new chapters automagically through /cron endpoint
- Checks RR for 'STUB' status 

## Prerequisites

- Node.js (compatible with the latest version)
- npm (Node package manager)
- Cron (optional, if you want to automatically fetch new chapters)

## Installation

1. Clone the repository:

    ```bash
    git clone https://github.com/arshem/webnovelscraper.git
    cd webnovelscraper
    ```

2. Install the necessary dependencies:

    ```bash
    npm install axios express cheerio ejs epub-gen ws
    ```

## Usage

1. Start the server:

    ```bash
    node novel.js
    ```

2. Open your browser and navigate to http://localhost:3000.

3. Input the starting URL of the web novel in the provided UI and click "Start Download".

4. Monitor the real-time updates on the download progress.

## How It Works

### File Structure

- `public/`: Contains static files, including downloaded chapters and cover images.
- `views/`: Contains EJS templates for rendering the web interface.
- `index.js`: Main Node.js script.
- `books.json`: Created on first web novel scraping to help crons run

### Main Components

- **Express Server**: Serves the web interface and handles API requests.
- **Axios**: Used for HTTP requests to fetch web novel content.
- **Cheerio**: Parses and extracts content from HTML.
- **WebSocket**: Provides real-time updates on download progress.
- **epub-gen**: Compiles downloaded chapters into an EPUB format.

### Endpoints

- `GET /`: Serves the main web interface.
- `POST /download`: Initiates the download process using the provided start URL.
- `GET /books`: Used to generate a JSON file of books in `public` directory
- `GET /cron`: Used to look for ongoing webnovels and download the latest chapters of each.

### Functions

- `fetchChapter(url, sendUpdate)`: Fetches a single chapter and returns its content and the URL for the next chapter.
- `saveChapter(content, chapterNumber, directory, sendUpdate)`: Saves the fetched chapter as an HTML file.
- `downloadCoverImage(coverUrl, directory, sendUpdate)`: Downloads the cover image.
- `createEpub(title, author, directory, sendUpdate)`: Compiles downloaded chapters into an EPUB.
- `downloadChapters(title, author, startUrl, chapterRange, coverUrl, sendUpdate)`: Manages the download process for the chapters.
- `getTitlePage(url, sendUpdate)`: Fetches the title page to extract novel metadata.
- `extractChapterNumber(chapterText)`: Grabs the chapter number to write the files correctly.


## Example

To download a novel, use its start URL in the web interface, for example:

```
Title Page: https://example.com/novel/123/
```

## Contributing

Contributions are welcome! Please follow these steps to contribute:

1. Fork the repository.
2. Create your feature branch (`git checkout -b feature/new-feature`).
3. Commit your changes (`git commit -am 'Add a new feature'`).
4. Push to the branch (`git push origin feature/new-feature`).
5. Create a new Pull Request.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

---

Feel free to provide feedback or report issues in the project's [issue tracker](https://github.com/arshem/webnovelscraper/issues).

Happy scraping! 📚
