import { NextRequest, NextResponse } from 'next/server';
import { isExtensionAuthError, requireExtensionAuth } from '@/lib/extension/auth';
import { deleteReusableAnswer, updateReusableAnswer } from '@/lib/extension/questions';
import {
  ExtensionSavedAnswerUpdateRequestSchema,
  normalizeExtensionRequestBody,
} from '@/lib/extension/schemas';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Edit one saved answer — its text, or whether it fires automatically.
 *
 * A 404 here means "not yours or not there", and the two are deliberately
 * indistinguishable: answering "exists, but not yours" would let one user probe
 * another's library for ids.
 */
export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const { userId } = await requireExtensionAuth(req);
    const { id } = await context.params;

    const body = await req.json().catch(() => ({}));
    const parsed = ExtensionSavedAnswerUpdateRequestSchema.safeParse(
      normalizeExtensionRequestBody(body)
    );
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: parsed.error.issues.map((issue) => issue.message).join('; '),
        },
        { status: 400 }
      );
    }

    const answer = await updateReusableAnswer({ userId, answerId: id, patch: parsed.data });
    if (!answer) {
      return NextResponse.json({ success: false, error: 'Saved answer not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, answer });
  } catch (error: unknown) {
    if (isExtensionAuthError(error)) {
      return NextResponse.json({ success: false, error: error.message }, { status: 401 });
    }
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update the saved answer',
      },
      { status: 500 }
    );
  }
}

/** Remove an answer from the library. Past applications are left untouched. */
export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const { userId } = await requireExtensionAuth(req);
    const { id } = await context.params;

    const deleted = await deleteReusableAnswer({ userId, answerId: id });
    if (!deleted) {
      return NextResponse.json({ success: false, error: 'Saved answer not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, deletedId: id });
  } catch (error: unknown) {
    if (isExtensionAuthError(error)) {
      return NextResponse.json({ success: false, error: error.message }, { status: 401 });
    }
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete the saved answer',
      },
      { status: 500 }
    );
  }
}
