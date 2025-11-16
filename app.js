console.log("app.js loaded");

// --- Wait for DOM to be ready ---
document.addEventListener('DOMContentLoaded', function() {
    console.log("DOM ready, initializing app...");

    // --- Initialize Map ---
    const map = L.map("map").setView([41.8781, -87.6298], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);

    // --- Globals ---
    let crimeData = [];
    let markers = [];
    let heatLayer = null;
    let selectedCrimeTypes = new Set();
    let routeLines = [];
    let routeMarkers = [];

    // --- Crime Colors ---
    const crimeColors = {
        THEFT: "#ff4444",
        BATTERY: "#ff8844",
        ASSAULT: "#ffcc00",
        ROBBERY: "#cc0000",
        HATE_CRIME: "#9900ff"
    };

    // --- Fetch Crime Data ---
    async function fetchCrime() {
        try {
            console.log("Fetching crime data...");
            const res = await fetch("/api/crime");
            const json = await res.json();
            crimeData = json.points;
            console.log(`✅ Loaded ${crimeData.length} crime points`);
            renderCrime();
        } catch(e) {
            console.error("❌ Error fetching crime data:", e);
            alert("Failed to load crime data. Make sure the server is running!");
        }
    }

    // --- Render Crime ---
    function renderCrime() {
        console.log("Rendering crime data...");
        
        // Remove old markers
        markers.forEach(m => map.removeLayer(m));
        markers = [];

        // Prepare heat points
        let heatPoints = [];

        crimeData.forEach(p => {
            // If no filters selected, don't show anything
            if (selectedCrimeTypes.size === 0) return;
            if (!selectedCrimeTypes.has(p.type)) return;

            // Marker
            const marker = L.circleMarker([Number(p.lat), Number(p.lng)], {
                radius: 6,
                color: crimeColors[p.type] || "#999",
                fillColor: crimeColors[p.type] || "#999",
                fillOpacity: 0.6
            }).addTo(map);
            marker.bindPopup(`<b>${p.type}</b><br>${p.desc || ''}<br><small>${p.date || ''}</small>`);
            markers.push(marker);

            // Heatmap intensity
            let intensity = (p.type === "HATE_CRIME" ? 1 : 0.6);
            heatPoints.push([Number(p.lat), Number(p.lng), intensity]);
        });

        // Heatmap with optimized canvas
        if (heatLayer) map.removeLayer(heatLayer);
        if (heatPoints.length > 0) {
            heatLayer = L.heatLayer(heatPoints, { 
                radius: 25, 
                blur: 15, 
                maxZoom: 17, 
                gradient: {0.2: 'yellow', 0.4: 'orange', 0.6: 'red', 1: 'purple'}
            }).addTo(map);
            console.log(`✅ Rendered ${markers.length} markers and heatmap`);
        }
    }

    // --- Filter Checkboxes ---
    const filterCheckboxes = document.querySelectorAll(".crime-filter");
    console.log(`Found ${filterCheckboxes.length} filter checkboxes`);
    
    filterCheckboxes.forEach(box => {
        box.checked = true;
        selectedCrimeTypes.add(box.value);

        box.addEventListener("change", () => {
            if (box.checked) selectedCrimeTypes.add(box.value);
            else selectedCrimeTypes.delete(box.value);
            console.log("Filter changed:", Array.from(selectedCrimeTypes));
            renderCrime();
        });
    });

    // --- Geocode Function ---
    async function geocode(address) {
        if (!address) return null;
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address + ", Chicago, IL")}`);
        const data = await res.json();
        if (data.length === 0) return null;
        return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    }

    // --- Calculate crime danger score for a point ---
    function getCrimeDangerScore(lat, lng) {
        let score = 0;
        const dangerRadius = 0.003; // ~300 meters
        
        crimeData.forEach(crime => {
            // Only consider selected crime types for routing
            if (selectedCrimeTypes.size === 0) return;
            if (!selectedCrimeTypes.has(crime.type)) return;
            
            const distance = Math.sqrt(
                Math.pow(lat - crime.lat, 2) + Math.pow(lng - crime.lng, 2)
            );
            
            if (distance < dangerRadius) {
                // Weight crimes differently
                const weights = {
                    HATE_CRIME: 10,
                    ROBBERY: 8,
                    ASSAULT: 7,
                    BATTERY: 5,
                    THEFT: 3
                };
                const weight = weights[crime.type] || 3;
                score += weight * (1 - distance / dangerRadius);
            }
        });
        
        return score;
    }

    // --- Get route from OSRM ---
    async function getRoute(start, end) {
        const url = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson&steps=true`;
        
        try {
            const res = await fetch(url);
            const data = await res.json();
            
            if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
                throw new Error('No route found');
            }
            
            return data.routes[0];
        } catch(e) {
            console.error("Routing error:", e);
            return null;
        }
    }

    // --- Calculate route safety score ---
    function calculateRouteSafety(coordinates) {
        let totalDanger = 0;
        let samples = Math.min(coordinates.length, 50); // Sample points along route
        let step = Math.floor(coordinates.length / samples);
        
        for (let i = 0; i < coordinates.length; i += step) {
            const [lng, lat] = coordinates[i];
            totalDanger += getCrimeDangerScore(lat, lng);
        }
        
        return totalDanger;
    }

    // --- Clear existing routes ---
    function clearRoutes() {
        routeLines.forEach(line => map.removeLayer(line));
        routeMarkers.forEach(marker => map.removeLayer(marker));
        routeLines = [];
        routeMarkers = [];
    }

    // --- Draw route on map ---
    function drawRoute(coordinates, label, distance, duration, dangerScore) {
        const latlngs = coordinates.map(coord => [coord[1], coord[0]]);
        
        const line = L.polyline(latlngs, {
            color: "#0066cc", // Dark blue route
            weight: 5,
            opacity: 0.8
        }).addTo(map);
        
        const distanceKm = (distance / 1000).toFixed(1);
        const durationMin = Math.round(duration / 60);
        const safetyRating = dangerScore < 20 ? "Safe ✓" : dangerScore < 50 ? "Moderate ⚠" : "High Risk ⚠⚠";
        
        line.bindPopup(`
            <b>${label}</b><br>
            Distance: ${distanceKm} km<br>
            Time: ${durationMin} min<br>
            Safety: ${safetyRating}<br>
            Crime Score: ${Math.round(dangerScore)}
        `);
        
        routeLines.push(line);
        
        // Fit map to show route
        map.fitBounds(line.getBounds(), { padding: [50, 50] });
    }

    // --- Route Button ---
    const routeBtn = document.getElementById("routeBtn");
    const startInput = document.getElementById("startInput");
    const endInput = document.getElementById("endInput");

    if (routeBtn && startInput && endInput) {
        console.log("✅ Route controls found and attached");
        
        routeBtn.addEventListener("click", async () => {
            const start = startInput.value.trim();
            const end = endInput.value.trim();

            if (!start || !end) {
                alert("Enter both start and end addresses.");
                return;
            }

            routeBtn.textContent = "Finding Routes...";
            routeBtn.disabled = true;

            try {
                console.log(`Finding routes from "${start}" to "${end}"`);
                
                const startCoord = await geocode(start);
                const endCoord = await geocode(end);

                if (!startCoord || !endCoord) {
                    alert("Could not find one or both addresses. Try being more specific (include street name and city).");
                    routeBtn.textContent = "Find Safe Route";
                    routeBtn.disabled = false;
                    return;
                }

                console.log("✅ Geocoding successful:", startCoord, endCoord);

                // Clear previous routes
                clearRoutes();
                
                // Add start/end markers
                const startMarker = L.marker([startCoord.lat, startCoord.lng], {
                    icon: L.icon({
                        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
                        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
                        iconSize: [25, 41],
                        iconAnchor: [12, 41]
                    })
                }).addTo(map).bindPopup("<b>Start</b>");
                
                const endMarker = L.marker([endCoord.lat, endCoord.lng], {
                    icon: L.icon({
                        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
                        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
                        iconSize: [25, 41],
                        iconAnchor: [12, 41]
                    })
                }).addTo(map).bindPopup("<b>Destination</b>");
                
                routeMarkers.push(startMarker, endMarker);

                console.log("✅ Markers added, fetching route...");

                // Get main route
                const mainRoute = await getRoute(startCoord, endCoord);
                
                if (!mainRoute) {
                    alert("Could not calculate route. Try different addresses.");
                    routeBtn.textContent = "Find Safe Route";
                    routeBtn.disabled = false;
                    return;
                }

                console.log("✅ Route received:", mainRoute);

                // Calculate danger score
                const coordinates = mainRoute.geometry.coordinates;
                const dangerScore = calculateRouteSafety(coordinates);
                
                console.log(`Drawing route with ${coordinates.length} points, safety score: ${dangerScore}`);
                
                // Draw the route
                drawRoute(
                    coordinates,
                    "Recommended Route",
                    mainRoute.distance,
                    mainRoute.duration,
                    dangerScore
                );
                
                console.log(`✅ Route created successfully!`);
                
            } catch(e) {
                console.error("❌ Error creating route:", e);
                alert("Failed to create route. Please try again.");
            } finally {
                routeBtn.textContent = "Find Safe Route";
                routeBtn.disabled = false;
            }
        });
    } else {
        console.error("❌ Could not find route controls!");
    }

    // --- Initialize ---
    console.log("Starting initial data fetch...");
    fetchCrime();
});
