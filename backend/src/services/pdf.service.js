/**
 * PDF Conversion Service
 * - Converts HTML OCR results to PDF format
 * - Splits PDF files into individual page images
 *
 * NOTE: Requires 'puppeteer' package and system poppler-utils:
 * npm install puppeteer
 * brew install poppler  (macOS)
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');
const execPromise = promisify(exec);

class PDFService {
  constructor() {
    this.puppeteerAvailable = false;
    this.puppeteer = null;
    this.popplerAvailable = false;

    try {
      this.puppeteer = require('puppeteer');
      this.puppeteerAvailable = true;
      console.log('✓ Puppeteer available for HTML→PDF conversion');
    } catch (error) {
      console.warn('⚠ Puppeteer not installed - HTML→PDF conversion disabled');
      console.warn('  Install with: npm install puppeteer');
    }

    // Check if system poppler-utils is available (async check done lazily)
    this._checkPopplerAvailability();
  }

  async _checkPopplerAvailability() {
    try {
      await execPromise('which pdftocairo');
      this.popplerAvailable = true;
      console.log('✓ System poppler-utils available for PDF→image conversion');
    } catch (error) {
      console.warn('⚠ poppler-utils not installed - PDF page splitting disabled');
      console.warn('  Install with:');
      console.warn('    macOS: brew install poppler');
      console.warn('    Ubuntu/Debian: apt-get install poppler-utils');
    }
  }

  /**
   * Convert HTML content to PDF buffer
   * @param {string} htmlContent - HTML content to convert
   * @param {object} options - PDF generation options
   * @returns {Promise<Buffer>} PDF buffer
   */
  async htmlToPdf(htmlContent, options = {}) {
    if (!this.puppeteerAvailable) {
      throw new Error('Puppeteer not installed. Install with: npm install puppeteer');
    }

    let browser = null;

    try {
      // Launch headless browser
      browser = await this.puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });

      const page = await browser.newPage();

      // Set content
      await page.setContent(htmlContent, {
        waitUntil: 'networkidle0'
      });

      // Generate PDF
      const pdfBuffer = await page.pdf({
        format: options.format || 'A4',
        printBackground: true,
        margin: {
          top: options.marginTop || '20mm',
          right: options.marginRight || '20mm',
          bottom: options.marginBottom || '20mm',
          left: options.marginLeft || '20mm'
        },
        ...options
      });

      console.log('✓ HTML→PDF conversion successful');
      return pdfBuffer;

    } catch (error) {
      console.error('PDF conversion error:', error);
      throw new Error(`Failed to convert HTML to PDF: ${error.message}`);
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  /**
   * Split PDF into individual page images (JPG)
   * @param {Buffer} pdfBuffer - PDF file buffer
   * @param {object} options - Conversion options
   * @returns {Promise<Array<Buffer>>} Array of page image buffers
   */
  async splitPdfIntoPages(pdfBuffer, options = {}) {
    if (!this.popplerAvailable) {
      throw new Error('poppler-utils not installed. Install with: brew install poppler');
    }

    // Create temp directory for PDF and output images
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-split-'));
    const pdfPath = path.join(tempDir, 'input.pdf');
    const outputDir = path.join(tempDir, 'pages');

    try {
      // Write PDF buffer to temp file
      await fs.writeFile(pdfPath, pdfBuffer);
      await fs.mkdir(outputDir, { recursive: true });

      const dpi = options.dpi || 300;
      console.log(`Splitting PDF into pages (DPI: ${dpi})...`);

      // Convert PDF to images using system pdftocairo
      const outputPrefix = path.join(outputDir, 'page');
      // Use -r for resolution (DPI), not -scale-to (pixels)
      const command = `pdftocairo -jpeg -r ${dpi} "${pdfPath}" "${outputPrefix}"`;

      await execPromise(command);

      // Read all generated page images
      const files = await fs.readdir(outputDir);
      const imageFiles = files
        .filter(f => f.startsWith('page') && f.endsWith('.jpg'))
        .sort((a, b) => {
          // Extract page numbers and sort numerically
          const numA = parseInt(a.match(/\d+/)?.[0] || '0');
          const numB = parseInt(b.match(/\d+/)?.[0] || '0');
          return numA - numB;
        });

      console.log(`✓ Split PDF into ${imageFiles.length} page(s)`);

      // Read each image file as buffer
      const pageBuffers = [];
      for (const imageFile of imageFiles) {
        const imagePath = path.join(outputDir, imageFile);
        const buffer = await fs.readFile(imagePath);
        pageBuffers.push(buffer);
      }

      return pageBuffers;

    } catch (error) {
      console.error('PDF splitting error:', error);
      throw new Error(`Failed to split PDF into pages: ${error.message}`);
    } finally {
      // Cleanup temp directory
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.warn('Failed to cleanup temp directory:', cleanupError);
      }
    }
  }

  /**
   * Get PDF page count
   * @param {Buffer} pdfBuffer - PDF file buffer
   * @returns {Promise<number>} Number of pages
   */
  async getPdfPageCount(pdfBuffer) {
    if (!this.popplerAvailable) {
      throw new Error('poppler-utils not installed');
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-count-'));
    const pdfPath = path.join(tempDir, 'input.pdf');

    try {
      await fs.writeFile(pdfPath, pdfBuffer);

      // Use pdfinfo to get page count (part of poppler-utils)
      const { stdout } = await execPromise(`pdfinfo "${pdfPath}"`);
      const match = stdout.match(/Pages:\s+(\d+)/);
      const pageCount = match ? parseInt(match[1]) : 1;

      console.log(`✓ PDF has ${pageCount} page(s)`);
      return pageCount;

    } catch (error) {
      console.error('Error getting PDF page count:', error);
      // Fallback: assume 1 page
      return 1;
    } finally {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.warn('Failed to cleanup temp directory:', cleanupError);
      }
    }
  }

  /**
   * Check if PDF conversion is available
   * @returns {boolean}
   */
  isAvailable() {
    return this.puppeteerAvailable;
  }

  /**
   * Check if PDF splitting is available
   * @returns {boolean}
   */
  isSplittingAvailable() {
    return this.popplerAvailable;
  }
}

module.exports = new PDFService();
