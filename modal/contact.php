<?php

// Put contacting email here
$php_main_email = "bonifacekechi@gmail.com";

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

function dizme_send_json($payload){
	echo json_encode($payload);
	exit;
}

// Fetching values from the request
$php_name    = isset($_POST['ajax_name'])    ? trim((string) $_POST['ajax_name'])    : '';
$php_email   = isset($_POST['ajax_email'])   ? trim((string) $_POST['ajax_email'])   : '';
$php_message = isset($_POST['ajax_message']) ? trim((string) $_POST['ajax_message']) : '';
$php_subject = isset($_POST['ajax_subject']) ? trim((string) $_POST['ajax_subject']) : '';

//No internal details are ever returned to the client.

if ($php_name === '' || $php_message === '') {
	dizme_send_json(array(
		'ok'      => false,
		'type'    => 'field',
		'field'   => '',
		'message' => 'Enter all required fields and try again.'
	));
}

// Sanitizing email
$php_email = filter_var($php_email, FILTER_SANITIZE_EMAIL);

// Validate, then respond as a field error the client can show under the input
if (!filter_var($php_email, FILTER_VALIDATE_EMAIL)) {
	dizme_send_json(array(
		'ok'      => false,
		'type'    => 'field',
		'field'   => 'email',
		'message' => 'This email address is not valid.'
	));
}

// Guard against header injection via the subject line.
$php_subject = preg_replace('/[\r\n]+/', ' ', $php_subject);
$php_subject = $php_subject !== '' ? $php_subject : 'Message from contact form';

$php_headers = 'MIME-Version: 1.0' . "\r\n";
$php_headers .= 'Content-type: text/html; charset=iso-8859-1' . "\r\n";
$php_headers .= 'From:' . $php_email . "\r\n";
$php_headers .= 'Cc:' . $php_email . "\r\n";

// Escape before embedding so the confirmation mail renders safely.
$safe_name    = htmlspecialchars($php_name, ENT_QUOTES);
$safe_email   = htmlspecialchars($php_email, ENT_QUOTES);
$safe_message = nl2br(htmlspecialchars($php_message, ENT_QUOTES));

$php_template = '<div style="padding:50px;">Hello ' . $safe_name . ',<br/>'
	. 'Thank you for contacting us.<br/><br/>'
	. '<strong>Name:</strong>  ' . $safe_name . '<br/>'
	. '<strong>Email:</strong>  ' . $safe_email . '<br/>'
	. '<strong>Message:</strong>  ' . $safe_message . '<br/><br/>'
	. 'This is a Contact Confirmation mail.'
	. '<br/>'
	. 'We will contact you as soon as possible.</div>';

$php_sendmessage = wordwrap($php_template, 70);

// send mail by PHP Mail Function
$php_sent = @mail($php_main_email, $php_subject, $php_sendmessage, $php_headers);

if ($php_sent) {
	dizme_send_json(array('ok' => true));
}

// Do not reveal why sending failed; keep the message human and generic.
dizme_send_json(array(
	'ok'      => false,
	'type'    => 'server',
	'message' => 'We couldn\'t send your message right now. Your entries have been kept. Try again.'
));