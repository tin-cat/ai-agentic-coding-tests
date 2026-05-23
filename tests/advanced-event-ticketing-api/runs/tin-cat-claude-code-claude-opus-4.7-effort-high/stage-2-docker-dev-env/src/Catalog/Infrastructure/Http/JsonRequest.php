<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Infrastructure\Http;

use Frontstage\Catalog\Domain\Exception\InvalidArgument;
use Symfony\Component\HttpFoundation\Request;

/**
 * JSON body parser used by controllers. Centralized so every endpoint reports
 * the same error shape on malformed input.
 */
final class JsonRequest
{
	/**
	 * @return array<string, mixed>
	 */
	public static function decode(Request $request): array
	{
		$body = (string) $request->getContent();
		if ('' === $body) {
			return [];
		}

		try {
			$decoded = json_decode($body, true, flags: JSON_THROW_ON_ERROR);
		} catch (\JsonException $e) {
			throw new InvalidArgument('Request body is not valid JSON: '.$e->getMessage());
		}

		if (!is_array($decoded)) {
			throw new InvalidArgument('Request body must be a JSON object.');
		}

		return $decoded;
	}
}
