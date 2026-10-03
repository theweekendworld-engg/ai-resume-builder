'use client';

import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

import { PasteBox } from './PasteBox';

/**
 * The page's one primary action. The paste box used to sit open above the
 * tabs; chat is the main way in now, so here it is a button, like "New issue".
 */
export function AddJobButton() {
    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button size="sm" className="h-8 gap-1.5">
                    <Plus aria-hidden className="size-4" />
                    Add job
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Add a job</DialogTitle>
                    <DialogDescription>Paste a job link or a LinkedIn post. It is scored against your record.</DialogDescription>
                </DialogHeader>
                <PasteBox />
            </DialogContent>
        </Dialog>
    );
}
