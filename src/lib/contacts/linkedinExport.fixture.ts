/** The shape of a real export: BOM, "Notes:" preamble, CRLF, quoted commas. */
export const CONNECTIONS_FIXTURE = [
    '\uFEFFNotes:',
    '"When exporting your connection data, you may notice that some of the email addresses are missing. You will only see email addresses for connections who have allowed their connections to see or download their email address using this setting https://www.linkedin.com/psettings/privacy/email. You can learn more here https://www.linkedin.com/help/linkedin/answer/261"',
    '',
    'First Name,Last Name,URL,Email Address,Company,Position,Connected On',
    'Priya,Sharma,https://www.linkedin.com/in/priya-sharma-1a2b3c,,"Stripe, Inc.",Technical Recruiter,12 Mar 2024',
    'Arjun,Mehta,https://www.linkedin.com/in/ArjunMehta/,arjun@example.com,Amazon Web Services (AWS),"Engineering Manager, Payments",03 Jan 2023',
    'Neha,,https://www.linkedin.com/in/neha-k,,Razorpay,"Senior Engineer ""Platform""",7-Feb-22',
    ',,https://www.linkedin.com/in/nobody,,,,',
    'Rahul,Verma,,,Flipkart,SDE II,01 Aug 2021',
    '',
].join('\r\n');
