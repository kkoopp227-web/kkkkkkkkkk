const { GlobalFonts } = require('@napi-rs/canvas');
const reshaper = require('arabic-persian-reshaper');
const fs = require('fs');
const path = require('path');

// Register Arabic Font
function registerFonts() {
    try {
        const fontPaths = [
            'C:\\Windows\\Fonts\\arial.ttf',
            'C:\\Windows\\Fonts\\tahoma.ttf',
            'C:\\Windows\\Fonts\\seguiemj.ttf',
            path.join(__dirname, 'fonts', 'ArabicFont.ttf') // Optional local font
        ];

        for (const fontPath of fontPaths) {
            if (fs.existsSync(fontPath)) {
                GlobalFonts.registerFromPath(fontPath, 'ArabicFont');
                // console.log(`Registered font: ${fontPath}`);
                break;
            }
        }
    } catch (err) {
        console.error('Failed to register font:', err);
    }
}

/**
 * Fixes Arabic text for rendering on Canvas (Reshaping + Bidi RTL)
 * @param {string} text The text to fix
 * @param {boolean} useArabicDigits Whether to convert English numbers to Arabic digits
 * @returns {string} The fixed text for Canvas
 */
function fixArabic(text, useArabicDigits = false) {
    if (!text) return "";
    
    text = String(text);

    // 1. Convert numbers to Arabic digits if requested
    if (useArabicDigits) {
        const en = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
        const ar = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
        for (let i = 0; i < 10; i++) {
            text = text.replace(new RegExp(en[i], 'g'), ar[i]);
        }
    }

    // Check if there is any Arabic character
    if (!/[\u0600-\u06FF]/.test(text)) return text;

    // 2. Reshape Arabic letters
    const reshaped = reshaper.ArabicShaper.convertArabic(text);

    // 3. Simple Bidi approach for Canvas (Reverse Arabic segments)
    // This splits the text into Arabic/space segments and non-Arabic segments
    const segments = reshaped.match(/([\u0600-\u06FF\s]+|[^\u0600-\u06FF\s]+)/g) || [reshaped];
    
    // Reverse the order of characters in Arabic segments, then reverse the whole array of segments
    const fixedSegments = segments.map(seg => {
        if (/[\u0600-\u06FF]/.test(seg)) {
            return seg.split('').reverse().join('');
        }
        return seg;
    });

    return fixedSegments.reverse().join('');
}

module.exports = {
    fixArabic,
    registerFonts
};
