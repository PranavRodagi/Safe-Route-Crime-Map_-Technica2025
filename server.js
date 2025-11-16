const express = require("express");
const axios = require("axios");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// Serve the frontend (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, "public")));

// Map Chicago crime types to your app's categories
function mapCrimeType(primaryType, description) {
    const type = primaryType.toUpperCase();
    const desc = (description || "").toUpperCase();
    
    // Check for gender-related hate crimes
    if (type === "OFFENSE INVOLVING CHILDREN" || 
        type === "SEX OFFENSE" ||
        type === "STALKING" ||
        type === "CRIM SEXUAL ASSAULT" ||
        (desc.includes("GENDER") || desc.includes("SEX") || desc.includes("FEMALE") || desc.includes("WOMAN"))) {
        return "HATE_CRIME";
    }
    
    if (type === "THEFT") return "THEFT";
    if (type === "BATTERY") return "BATTERY";
    if (type === "ASSAULT") return "ASSAULT";
    if (type === "ROBBERY") return "ROBBERY";
    
    // Default to closest match
    if (type.includes("THEFT") || type === "BURGLARY" || type === "MOTOR VEHICLE THEFT") return "THEFT";
    if (type.includes("BATTERY")) return "BATTERY";
    if (type.includes("ASSAULT")) return "ASSAULT";
    if (type.includes("ROBBERY")) return "ROBBERY";
    
    return "THEFT"; // default fallback
}

// === CRIME DATA ENDPOINT ===
app.get("/api/crime", async (req, res) => {
    try {
        // Get recent crime data from Chicago
        const url = "https://data.cityofchicago.org/resource/ijzp-q8t2.json?$limit=500&$where=date>'2024-11-01'";

        const response = await axios.get(url, {
            headers: { "X-App-Token": "" } // optional but recommended
        });

        const data = response.data;

        const points = data
            .filter(d => d.latitude && d.longitude)
            .map(d => ({
                lat: parseFloat(d.latitude),
                lng: parseFloat(d.longitude),
                type: mapCrimeType(d.primary_type || "", d.description || ""),
                desc: d.description || d.primary_type || "",
                date: d.date ? new Date(d.date).toLocaleDateString() : ""
            }));

        console.log(`✅ Fetched ${points.length} crime points`);
        res.json({ points });
    } catch (err) {
        console.error("❌ ERROR fetching crime data:", err.message);
        res.status(500).json({ error: "Failed to fetch crime data" });
    }
});

// === START SERVER ===
const PORT = 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📂 Serving files from: ${path.join(__dirname, "public")}`);
    console.log(`🗺️  Open http://localhost:${PORT} in your browser`);
});
