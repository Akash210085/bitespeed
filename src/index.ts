import express, { Request, Response, Application } from 'express';
import { PrismaClient } from '../generated/prisma';
import type { Contact } from '../generated/prisma';

const prisma = new PrismaClient();
const app: Application = express();

app.use(express.json());

app.post('/identify', async (req: Request, res: Response): Promise<void> => {
    const { email, phoneNumber } = req.body;

    if (!email && !phoneNumber) {
        res.status(400).json({ error: 'At least one of email or phoneNumber is required' });
        return;
    } else {
        console.log(`Received request with email: ${email}, phoneNumber: ${phoneNumber}`);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
