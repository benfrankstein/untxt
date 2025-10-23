/**
 * PDF Conversion Service
 * Converts HTML OCR results to PDF format
 *
 * NOTE: Requires 'puppeteer' package to be installed:
 * npm install puppeteer
 */

class PDFService {
  constructor() {
    this.puppeteerAvailable = false;
    this.puppeteer = null;

    try {
      this.puppeteer = require('puppeteer');
      this.puppeteerAvailable = true;
      console.log('✓ Puppeteer available for HTML→PDF conversion');
    } catch (error) {
      console.warn('⚠ Puppeteer not installed - HTML→PDF conversion disabled');
      console.warn('  Install with: npm install puppeteer');
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
   * Check if PDF conversion is available
   * @returns {boolean}
   */
  isAvailable() {
    return this.puppeteerAvailable;
  }
}

module.exports = new PDFService();
