const express = require('express');
const app = express();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config()
const jwt = require('jsonwebtoken');
const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY);
const cors = require('cors');
const port = process.env.PORT || 5000;


app.use(cors())
app.use(express.json())

const verifyJwt = (req, res, next) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
        return res.status(401).send({ error: true, message: 'unauthorized access' })
    }
    const token = authorization.split(' ')[1]
    jwt.verify(token, process.env.JWT_TOKEN, (error, decoded) => {
        if (error) {
            return res.status(403).send({ error: true, message: 'unauthorized access' })
        }
        req.decoded = decoded
        next()
    });
}

const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.4plofch.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        const userDatabase = client.db('bistroDB').collection('users')
        const menuDatabase = client.db('bistroDB').collection('menu')
        const reviewDatabase = client.db('bistroDB').collection('reviews')
        const cartDatabase = client.db('bistroDB').collection('carts')
        const paymentDatabase = client.db('bistroDB').collection('payments')

        // jwt
        app.post('/tokens', async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.JWT_TOKEN, { expiresIn: "300d" })
            res.send({ token })
        })

        // Warning: use verifyJWT before using verifyAdmin
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email }
            const user = await userDatabase.findOne(query)

            if (user?.role !== 'admin') {
                return res.status(403).send({ error: true, message: 'forbidden access' })
            }
            next()
        }

        // User api
        app.get('/users', verifyJwt, verifyAdmin, async (req, res) => {
            const result = await userDatabase.find().toArray();
            res.send(result)
        })

        // security level
        // 1. verifyJwt
        // 2. decoded email === email
        // 3. is admin
        app.get('/users/admin/:email', verifyJwt, async (req, res) => {
            const email = req.params.email;

            if (req.decoded.email !== email) {
                res.send({ admin: false })
            }

            const query = { email: email }
            const user = await userDatabase.findOne(query)
            const result = { admin: user?.role === 'admin' }
            res.send(result)
        })

        app.post('/users', async (req, res) => {
            const user = req.body;
            const query = { email: user.email };
            const existingUser = await userDatabase.findOne(query);
            if (existingUser) {
                return res.send({ message: 'user already exists' })
            }
            const result = await userDatabase.insertOne(user);
            res.send(result)
        })

        app.patch('/users/admin/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: {
                    role: 'admin'
                }
            }
            const result = await userDatabase.updateOne(query, updateDoc);
            res.send(result)
        })


        // Menu api
        app.get('/menu', async (req, res) => {
            const result = await menuDatabase.find().toArray()
            res.send(result)
        })

        app.post('/menu', verifyJwt, verifyAdmin, async (req, res) => {
            const item = req.body;
            const result = await menuDatabase.insertOne(item)
            res.send(result)
        })

        app.delete('/menu/:id', verifyJwt, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await menuDatabase.deleteOne(query)
            res.send(result)
        })


        // Reviews api
        app.get('/reviews', async (req, res) => {
            const result = await reviewDatabase.find().toArray()
            res.send(result)
        })


        // Carts api
        app.get('/carts', verifyJwt, async (req, res) => {
            const email = req.query.email;
            if (!email) {
                res.send([]);
            }
            const decodedEmail = req.decoded.email;

            if (email !== decodedEmail) {
                return res.status(403).send({ error: true, message: 'forbidden access' })
            }

            const query = { email: email }
            const result = await cartDatabase.find(query).toArray()
            res.send(result)
        })

        app.post('/carts', async (req, res) => {
            const item = req.body;
            const result = await cartDatabase.insertOne(item)
            res.send(result)
        })

        app.delete('/carts/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await cartDatabase.deleteOne(query)
            res.send(result)
        })


        // create payment intent
        app.post("/create-payment-intent", verifyJwt, async (req, res) => {
            const { price } = req.body;

            const amount = parseInt(price * 100);
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            });

            res.send({
                clientSecret: paymentIntent.client_secret
            });

        })

        // Payment
        app.post('/payments', verifyJwt, async (req, res) => {
            const payment = req.body;
            const insertResult = await paymentDatabase.insertOne(payment)

            const query = { _id: { $in: payment.cartItemId.map(id => new ObjectId(id)) } }
            const deleteResult = await cartDatabase.deleteMany(query)

            res.send({ insertResult, deleteResult })
        })

        app.get('/admin-state', verifyJwt, verifyAdmin, async (req, res) => {
            const customers = await userDatabase.estimatedDocumentCount()
            const products = await menuDatabase.estimatedDocumentCount()
            const orders = await paymentDatabase.estimatedDocumentCount()
            const payment = await paymentDatabase.find().toArray()
            const revenue = payment.reduce((sum, entry) => sum + entry.price, 0)

            res.send({
                customers,
                products,
                orders,
                revenue
            })
        })


        /**
    * ---------------
    * BANGLA SYSTEM(second best solution)
    * ---------------
    * 1. load all payments
    * 2. for each payment, get the menuItems array
    * 3. for each item in the menuItems array get the menuItem from the menu collection
    * 4. put them in an array: allOrderedItems
    * 5. separate allOrderedItems by category using filter
    * 6. now get the quantity by using length: pizzas.length
    * 7. for each category use reduce to get the total amount spent on this category
    * 
   */

        //  [
        //     {
        //       $lookup: {
        //         from: 'menu',
        //         localField: 'menuItems',
        //         foreignField: '_id',
        //         as: 'menuItemsData'
        //       }
        //     },
        //     {
        //       $unwind: '$menuItemsData'
        //     },
        //     {
        //       $group: {
        //         _id: '$menuItemsData.category',
        //         count: { $sum: 1 },
        //         total: { $sum: '$menuItemsData.price' }
        //       }
        //     },
        //     {
        //       $project: {
        //         category: '$_id',
        //         count: 1,
        //         total: { $round: ['$total', 2] },
        //         _id: 0
        //       }
        //     }
        //   ];

        app.get('/order-states', async (req, res) => {
            const pipeline = [
                {
                    $lookup: {
                        from: 'menu',
                        localField: 'menuItems',
                        foreignField: '_id',
                        as: 'menuItemsData'
                    }
                },
                {
                    $unwind: '$menuItemsData'
                },
                {
                    $group: {
                        _id: '$menuItemsData.category',
                        count: { $sum: 1 },
                        total: { $sum: '$menuItemsData.price' }
                    }
                }
            ]

            const result = await paymentDatabase.aggregate(pipeline).toArray()
            console.log(result)
            res.send(result)
        })

        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);



app.get('/', (req, res) => {
    res.send('bistro boss is running...')
})

app.listen(port, () => {
    console.log(`bistro boss is running on port: ${port}`)
})

