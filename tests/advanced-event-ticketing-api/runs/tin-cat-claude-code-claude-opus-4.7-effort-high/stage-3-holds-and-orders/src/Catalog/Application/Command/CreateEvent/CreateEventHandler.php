<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Application\Command\CreateEvent;

use Frontstage\Catalog\Domain\Exception\InvalidArgument;
use Frontstage\Catalog\Domain\Model\Event\Event;
use Frontstage\Catalog\Domain\Model\Event\EventDescription;
use Frontstage\Catalog\Domain\Model\Event\EventId;
use Frontstage\Catalog\Domain\Model\Event\EventTitle;
use Frontstage\Catalog\Domain\Model\Event\StartsAt;
use Frontstage\Catalog\Domain\Model\PriceTier\PriceTier;
use Frontstage\Catalog\Domain\Model\PriceTier\PriceTierId;
use Frontstage\Catalog\Domain\Model\PriceTier\PriceTierName;
use Frontstage\Catalog\Domain\Model\Shared\Currency;
use Frontstage\Catalog\Domain\Model\Shared\Money;
use Frontstage\Catalog\Domain\Model\Venue\GeneralAdmissionSeating;
use Frontstage\Catalog\Domain\Model\Venue\Row;
use Frontstage\Catalog\Domain\Model\Venue\Seat;
use Frontstage\Catalog\Domain\Model\Venue\SeatId;
use Frontstage\Catalog\Domain\Model\Venue\Section;
use Frontstage\Catalog\Domain\Model\Venue\SectionedSeating;
use Frontstage\Catalog\Domain\Model\Venue\SeatingDefinition;
use Frontstage\Catalog\Domain\Model\Venue\Venue;
use Frontstage\Catalog\Domain\Model\Venue\VenueName;
use Frontstage\Catalog\Domain\Repository\EventRepository;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;

#[AsMessageHandler(bus: 'command.bus')]
final class CreateEventHandler
{
	public function __construct(private readonly EventRepository $events)
	{
	}

	public function __invoke(CreateEventCommand $command): void
	{
		$priceTiers = [];
		foreach ($command->priceTiers as $tier) {
			$priceTiers[] = new PriceTier(
				PriceTierId::of((string) ($tier['id'] ?? '')),
				PriceTierName::of((string) ($tier['name'] ?? '')),
				Money::of(
					(int) ($tier['priceAmount'] ?? 0),
					Currency::of((string) ($tier['priceCurrency'] ?? '')),
				),
			);
		}

		$seating = $this->buildSeating($command->seating);

		$venue = new Venue(
			VenueName::of($command->venueName),
			$seating,
		);

		$event = Event::create(
			EventId::fromString($command->eventId),
			EventTitle::of($command->title),
			EventDescription::of($command->description),
			StartsAt::fromIsoString($command->startsAtIso),
			$venue,
			$priceTiers,
		);

		$this->events->save($event);
	}

	/**
	 * @param array{
	 *     type: string,
	 *     sections?: list<array{name:string, rows:list<array{label:string, seats:list<array{number:string, priceTierId:string}>}>}>,
	 *     capacity?: int,
	 *     priceTierId?: string,
	 * } $seating
	 */
	private function buildSeating(array $seating): SeatingDefinition
	{
		$type = (string) ($seating['type'] ?? '');

		return match ($type) {
			'sectioned' => $this->buildSectionedSeating($seating['sections'] ?? []),
			'general_admission' => new GeneralAdmissionSeating(
				(int) ($seating['capacity'] ?? 0),
				PriceTierId::of((string) ($seating['priceTierId'] ?? '')),
			),
			default => throw new InvalidArgument(sprintf('Unknown seating type "%s".', $type)),
		};
	}

	/**
	 * @param list<array{name:string, rows:list<array{label:string, seats:list<array{number:string, priceTierId:string}>}>}> $rawSections
	 */
	private function buildSectionedSeating(array $rawSections): SectionedSeating
	{
		$sections = [];
		foreach ($rawSections as $rawSection) {
			$rows = [];
			foreach ($rawSection['rows'] ?? [] as $rawRow) {
				$seats = [];
				foreach ($rawRow['seats'] ?? [] as $rawSeat) {
					$seats[] = new Seat(
						SeatId::of(
							(string) ($rawSection['name'] ?? ''),
							(string) ($rawRow['label'] ?? ''),
							(string) ($rawSeat['number'] ?? ''),
						),
						PriceTierId::of((string) ($rawSeat['priceTierId'] ?? '')),
					);
				}
				$rows[] = new Row((string) ($rawRow['label'] ?? ''), $seats);
			}
			$sections[] = new Section((string) ($rawSection['name'] ?? ''), $rows);
		}

		return new SectionedSeating($sections);
	}
}
