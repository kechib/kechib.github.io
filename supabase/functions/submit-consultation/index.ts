Deno.serve(async (req: Request): Promise<Response> => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    });
  }
  
  try {
    const body = await req.json();
    const submissionId = body.submission_id || body.submissionId;
    
    if (!submissionId) {
      return Response.json(
        { error: 'submission_id is required' },
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    const { data, error } = await supabase
      .from('consultation_submissions')
      .upsert({
        submission_id: submissionId,
        brand: body.brand,
        contact_name: body.contact_name,
        contact_email: body.contact_email,
        company_category: body.company_category,
        brand_intention: body.brand_intention,
        business_decision: body.business_decision,
        project_stage: body.project_stage,
        selected_services: body.selected_services,
        products: body.products,
        connected_journey: body.connected_journey,
        customer_tasks: body.customer_tasks,
        fragranceScope: body.fragranceScope,
        makeupScope: body.makeupScope,
        bodyCareScope: body.bodyCareScope,
        packagingScope: body.packagingScope,
        retailScope: body.retailScope,
        webScope: body.webScope,
        mobileWebScope: body.mobileWebScope,
        iosScope: body.iosScope,
        androidScope: body.androidScope,
        remediationScope: body.remediationScope,
        retestScope: body.retestScope,
        researchScope: body.researchScope,
        deliverables: body.deliverables,
        timeline: body.timeline,
        stakeholders: body.stakeholders,
        confidential: body.confidential,
        ndaRequired: body.ndaRequired,
        budget_preference: body.budget_preference,
        schema_version: body.schema_version || '1.0',
        status: 'submitted',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'submission_id' });
    
    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
    
    const { error: eventError } = await supabase
      .from('consultation_events')
      .insert({
        submission_id: submissionId,
        event_type: 'submission.received',
        actor_type: 'system',
        safe_metadata: {},
      });
    
    if (eventError) {
      console.error('Failed to insert consultation_event:', eventError);
    }
    
    // Retrieve the stored public_reference from the canonical row.
    // The upsert with onConflict does not automatically return generated
    // values; we select the row to obtain the authoritative reference.
    const { data: sub, error: subErr } = await supabase
      .from('consultation_submissions')
      .select('public_reference')
      .eq('submission_id', submissionId)
      .single();
    
    let publicReference = '';
    if (subErr || !sub) {
      // Fallback: attempt to extract from the upsert result metadata if available,
      // but conservatively empty so we do not fabricate a reference.
      publicReference = '';
    } else {
      publicReference = sub.public_reference || '';
    }
    
    return Response.json(
      { success: true, submissionId, publicReference, message: 'Your consultation request has been received.' },
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
    
  } catch (err) {
    console.error('Submit consultation error:', err);
    return Response.json(
      { error: 'Internal server error' },
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
