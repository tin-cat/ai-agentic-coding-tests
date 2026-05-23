<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Application\Command\CreateEvent;

/**
 * Carries the data needed to create a draft event. The shape is plain PHP
 * arrays and scalars: it is the application layer's job to translate this
 * input (decoded from JSON by the HTTP adapter) into domain value objects
 * inside the handler.
 *
 * priceTiers: list<array{id:string, name:string, priceAmount:int, priceCurrency:string}>
 *
 * seating is either:
 *   ['type' => 'sectioned', 'sections' => list<array{
 *       name: string,
 *       rows: list<array{label: string, seats: list<array{number:string, priceTierId:string}>}>
 *   }>]
 *  or
 *   ['type' => 'general_admission', 'capacity' => int, 'priceTierId' => string]
 */
final class CreateEventCommand
{
	/**
	 * @param list<array{id:string, name:string, priceAmount:int, priceCurrency:string}> $priceTiers
	 * @param array{
	 *     type: string,
	 *     sections?: list<array{name:string, rows:list<array{label:string, seats:list<array{number:string, priceTierId:string}>}>}>,
	 *     capacity?: int,
	 *     priceTierId?: string,
	 * } $seating
	 */
	public function __construct(
		public readonly string $eventId,
		public readonly string $title,
		public readonly string $description,
		public readonly string $startsAtIso,
		public readonly string $venueName,
		public readonly array $seating,
		public readonly array $priceTiers,
	) {
	}
}
