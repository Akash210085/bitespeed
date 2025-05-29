import express, { Request, Response, Application } from 'express';
import { PrismaClient } from '../generated/prisma';
import type { Contact } from '../generated/prisma';

const prisma = new PrismaClient();
const app: Application = express();

app.use(express.json());

// Helper: Get the root primary for a contact
async function getPrimary(contact: Contact): Promise<Contact> {
    let current = contact;
    while (current.linkedId) {
        const parent = await prisma.contact.findUnique({ where: { id: current.linkedId } });
        if (!parent) break;
        current = parent;
    }
    return current;
}



// Helper: Get all contacts in a tree (primary + all secondaries, any level)
async function getAllLinkedContacts(primaryId: number): Promise<Contact[]> {
    const result: Contact[] = [];
    let queue = [primaryId];
    while (queue.length > 0) {
        const children = await prisma.contact.findMany({
            where: { linkedId: { in: queue }, deletedAt: null }
        });
        result.push(...children);
        queue = children.map(c => c.id);
    }
    // Add the primary itself
    const primary = await prisma.contact.findUnique({ where: { id: primaryId } });
    if (primary) result.unshift(primary);
    return result;
}


// Helper: Format response
function formatResponse(contacts: Contact[]) {
    const primary = contacts.find(c => c.linkPrecedence === 'primary')!;
    const secondaries = contacts.filter(c => c.linkPrecedence === 'secondary');
    const emails = [
        ...new Set([primary.email, ...secondaries.map(s => s.email)].filter(Boolean))
    ] as string[];
    const phones = [
        ...new Set([primary.phoneNumber, ...secondaries.map(s => s.phoneNumber)].filter(Boolean))
    ] as string[];
    return {
        contact: {
            primaryContatctId: primary.id,
            emails,
            phoneNumbers: phones,
            secondaryContactIds: secondaries.map(s => s.id)
        }
    };
}

app.post('/identify', async (req: Request, res: Response): Promise<void> => {
    const { email, phoneNumber } = req.body;

    if (!email && !phoneNumber) {
        res.status(400).json({ error: 'At least one of email or phoneNumber is required' });
        return;
    } else {
        console.log(`Received request with email: ${email}, phoneNumber: ${phoneNumber}`);
    }


    try {
        // 1. Find one contact by email, one by phoneNumber (if provided)
        const emailContact = email
            ? await prisma.contact.findFirst({
                where: { email, deletedAt: null },
                orderBy: { createdAt: 'asc' }
            })
            : null;
        const phoneContact = phoneNumber
            ? await prisma.contact.findFirst({
                where: { phoneNumber, deletedAt: null },
                orderBy: { createdAt: 'asc' }
            })
            : null;

        // 2. Find their primaries (max 2)
        const emailPrimary = emailContact ? await getPrimary(emailContact) : null;
        const phonePrimary = phoneContact ? await getPrimary(phoneContact) : null;


        // === CASE 1: No existing contact, create new primary ===
        if (!emailContact && !phoneContact) {
            const newPrimary = await prisma.contact.create({
                data: {
                    email: email || null,
                    phoneNumber: phoneNumber || null,
                    linkPrecedence: 'primary'
                }
            });
            res.json(formatResponse([newPrimary]));
            return;
        }

        // === CASE 2: Only one match (either email or phone) ===
        if ((emailContact && !phoneContact) || (!emailContact && phoneContact)) {
            if (emailContact && emailPrimary) {
                // Only email match
                await prisma.contact.create({
                    data: {
                        email: email || null,
                        phoneNumber: phoneNumber || null,
                        linkedId: emailContact.id,
                        linkPrecedence: 'secondary'
                    }
                });

                const updatedGroup = await getAllLinkedContacts(emailPrimary.id);
                res.json(formatResponse(updatedGroup));
                return;
            } else if (phoneContact && phonePrimary) {
                // Only phone match
                await prisma.contact.create({
                    data: {
                        email: email || null,
                        phoneNumber: phoneNumber || null,
                        linkedId: phoneContact.id,
                        linkPrecedence: 'secondary'
                    }
                });
                const updatedGroup = await getAllLinkedContacts(phonePrimary.id);
                res.json(formatResponse(updatedGroup));
                return;
            }

        }


        // === CASE 3: Both match and may have same or different primaries ===
        if (emailPrimary && phonePrimary) {
            // If same primary, just return group
            if (emailPrimary.id === phonePrimary.id) {
                const groupContacts = await getAllLinkedContacts(emailPrimary.id);
                res.json(formatResponse(groupContacts));
                return;
            }

            // If different primaries, merge: newer becomes secondary of older
            const [olderPrimary, newerPrimary] =
                emailPrimary.createdAt < phonePrimary.createdAt
                    ? [emailPrimary, phonePrimary]
                    : [phonePrimary, emailPrimary];

            // 1. Update newer primary to secondary and link to older
            await prisma.contact.update({
                where: { id: newerPrimary.id },
                data: {
                    linkPrecedence: 'secondary',
                    linkedId: olderPrimary.id,
                    updatedAt: new Date()
                }
            });

            const groupContacts = await getAllLinkedContacts(olderPrimary.id);
            res.json(formatResponse(groupContacts));
            return;
        }

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
