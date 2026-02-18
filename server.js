const express = require('express');
const axios = require('axios');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const app = express();

// M-Pesa credentials (replace with your actual credentials)
const consumer_key = 'your_consumer_key';
const consumer_secret = 'your_consumer_secret';
const businessShortCode = "174379";
const passkey = 'your_passkey';

// Temporary database for bike inventory
let bikeInventory = [];

// Configure multer for file uploads
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    fileFilter: function (req, file, cb) {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'));
        }
    },
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});

app.use(express.static('public'));
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// Image upload route
app.post('/api/upload-image', upload.single('image'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image file provided' });
        }
        
        const imageUrl = `/uploads/${req.file.filename}`;
        console.log('Image uploaded:', imageUrl);
        
        res.json({ imageUrl: imageUrl });
    } catch (error) {
        console.error('Image upload error:', error);
        res.status(500).json({ error: 'Image upload failed' });
    }
});

// 1. Get Access Token
async function getMpesaToken() {
    const auth = Buffer.from(`${consumer_key}:${consumer_secret}`).toString('base64');
    const res = await axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
        headers: { Authorization: `Basic ${auth}` }
    });
    return res.data.access_token;
}

// 2. Trigger STK Push
app.post('/api/mpesa-pay', async (req, res) => {
    try {
        console.log('M-Pesa payment request:', req.body);
        const token = await getMpesaToken();
        const phone = req.body.phone; // e.g., 2547XXXXXXXX
        const amount = req.body.amount || 13000; // Default: $100 converted to KES

        const date = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
        const password = Buffer.from(businessShortCode + passkey + date).toString('base64');

        await axios.post('https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest', {
            "BusinessShortCode": businessShortCode,
            "Password": password,
            "Timestamp": date,
            "TransactionType": "CustomerPayBillOnline",
            "Amount": amount,
            "PartyA": phone,
            "PartyB": businessShortCode,
            "PhoneNumber": phone,
            "CallBackURL": "https://yourdomain.com/api/callback",
            "AccountReference": "BikeHub",
            "TransactionDesc": "Bike Hub Payment"
        }, {
            headers: { Authorization: `Bearer ${token}` }
        });

        res.json({ message: "Check your phone for the M-Pesa prompt!" });
    } catch (error) {
        console.error('M-Pesa error:', error.message);
        res.status(500).json({ error: "Payment processing failed" });
    }
});

// Route to add a bike
app.post('/api/add-bike', (req, res) => {
    try {
        console.log('Received bike data:', req.body);
        const newBike = req.body;
        
        // Validation
        if (!newBike.name || !newBike.price || !newBike.image || !newBike.desc) {
            return res.status(400).json({ error: 'All fields are required' });
        }
        
        bikeInventory.push(newBike);
        console.log("Current Inventory:", bikeInventory);
        res.status(201).json({ message: "Bike saved successfully!" });
    } catch (error) {
        console.error('Error adding bike:', error);
        res.status(500).json({ error: 'Server error while adding bike' });
    }
});

// Route for the frontend to GET all bikes
app.get('/api/bikes', (req, res) => {
    res.json(bikeInventory);
});

// Route to delete a bike
app.delete('/api/bikes/:index', (req, res) => {
    try {
        const index = parseInt(req.params.index);
        console.log('Deleting bike at index:', index);
        console.log('Current inventory:', bikeInventory);
        console.log('Inventory length:', bikeInventory.length);
        
        if (index < 0 || index >= bikeInventory.length) {
            return res.status(404).json({ error: 'Bike not found', index: index, inventoryLength: bikeInventory.length });
        }
        
        const deletedBike = bikeInventory.splice(index, 1);
        console.log('Deleted bike:', deletedBike[0]);
        console.log('Current Inventory after deletion:', bikeInventory);
        
        res.json({ message: 'Bike deleted successfully', bike: deletedBike[0] });
    } catch (error) {
        console.error('Error deleting bike:', error);
        res.status(500).json({ error: 'Server error while deleting bike' });
    }
});

// Route to delete a bike by name
app.delete('/api/bikes/name/:name', (req, res) => {
    try {
        const bikeName = decodeURIComponent(req.params.name);
        console.log('Deleting bike by name:', bikeName);
        
        const bikeIndex = bikeInventory.findIndex(bike => bike.name === bikeName);
        
        if (bikeIndex === -1) {
            return res.status(404).json({ error: 'Bike not found' });
        }
        
        const deletedBike = bikeInventory.splice(bikeIndex, 1);
        console.log('Deleted bike:', deletedBike[0]);
        console.log('Current Inventory:', bikeInventory);
        
        res.json({ message: 'Bike deleted successfully', bike: deletedBike[0] });
    } catch (error) {
        console.error('Error deleting bike:', error);
        res.status(500).json({ error: 'Server error while deleting bike' });
    }
});

// 404 handler for API routes
app.use('/api/*', (req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
});

// 404 handler for non-API routes (must be last)
app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API endpoint not found' });
    }
    next();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});