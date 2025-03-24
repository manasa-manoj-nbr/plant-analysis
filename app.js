require("dotenv").config();
const express = require("express");
const multer = require("multer");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const fsPromises = fs.promises;
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

const app = express();
const port = process.env.PORT || 5000;
const upload = multer({ dest: "upload/" });

app.use(express.json({ limit: "10mb" }));
app.use(express.static("public"));

async function analyzeImage(imageData, mimeType) {
    try {

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

        const response = await model.generateContent({
            contents: [
                {
                    role: "user",
                    parts: [
                        { text: "Analyze this plant image and provide details about its species, health, and care recommendations." },
                        { inlineData: { mimeType: mimeType, data: imageData } }
                    ]
                }
            ]
        });

        const resultText = response.candidates?.[0]?.content?.parts?.[0]?.text || "No analysis available.";
        return resultText;
    } catch (error) {
        console.error("Error analyzing image:", error);
        throw new Error("Failed to analyze image with Google Generative AI.");
    }
}

app.post("/analyze", upload.single("image"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No image file uploaded" });
        }

        if (!process.env.GOOGLE_API_KEY) {
            return res.status(500).json({ error: "Google API key is not configured" });
        }

        const imagePath = req.file.path;
        const imageData = await fsPromises.readFile(imagePath, { encoding: 'base64' });

        if (!imageData) {
            await fsPromises.unlink(imagePath);
            return res.status(400).json({ error: "Could not read image file" });
        }

        const plantInfo = await analyzeImage(imageData, req.file.mimetype);

        await fsPromises.unlink(imagePath);

        res.json({
            result: plantInfo,
            image: `data:${req.file.mimetype};base64,${imageData}`
        });

    } catch (error) {
        console.error("Error:", error);
        res.status(500).json({ error: "Image analysis failed", message: error.message });
    }
});

app.post("/download", express.json(), async (req, res) => {
    const { result, image } = req.body;

    try {
        const reportsDir = path.join(__dirname, "reports");
        await fsPromises.mkdir(reportsDir, { recursive: true });

        const filename = `plant_analysis_report_${Date.now()}.pdf`;
        const filePath = path.join(reportsDir, filename);
        const writeStream = fs.createWriteStream(filePath);
        const doc = new PDFDocument();
        doc.pipe(writeStream);


        doc.fontSize(24).text("Plant Analysis Report", { align: "center" });
        doc.moveDown();
        doc.fontSize(14).text(`Date: ${new Date().toLocaleDateString()}`);
        doc.moveDown();
        doc.fontSize(14).text(result || "No analysis available.", { align: "left" });

        if (image) {
            const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
            const buffer = Buffer.from(base64Data, "base64");
            doc.moveDown();
            doc.image(buffer, { fit: [500, 300], align: "center", valign: "center" });
        }

        doc.end();

        await new Promise((resolve, reject) => {
            writeStream.on("finish", resolve);
            writeStream.on("error", reject);
        });

        res.download(filePath, (err) => {
            if (err) {
                res.status(500).json({ error: "Error downloading the PDF report" });
            }
            fsPromises.unlink(filePath);
        });

    } catch (error) {
        console.error("Error generating PDF report:", error);
        res.status(500).json({ error: "An error occurred while generating the PDF report" });
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
