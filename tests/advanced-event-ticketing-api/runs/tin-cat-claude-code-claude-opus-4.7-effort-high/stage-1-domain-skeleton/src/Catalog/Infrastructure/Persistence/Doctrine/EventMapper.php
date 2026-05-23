<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Infrastructure\Persistence\Doctrine;

use Frontstage\Catalog\Domain\Exception\InvalidArgument;
use Frontstage\Catalog\Domain\Model\Event\Event;
use Frontstage\Catalog\Domain\Model\Event\EventDescription;
use Frontstage\Catalog\Domain\Model\Event\EventId;
use Frontstage\Catalog\Domain\Model\Event\EventStatus;
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
use Frontstage\Catalog\Domain\Model\Venue\SeatStatus;
use Frontstage\Catalog\Domain\Model\Venue\Section;
use Frontstage\Catalog\Domain\Model\Venue\SectionedSeating;
use Frontstage\Catalog\Domain\Model\Venue\SeatingDefinition;
use Frontstage\Catalog\Domain\Model\Venue\Venue;
use Frontstage\Catalog\Domain\Model\Venue\VenueName;
use Frontstage\Catalog\Infrastructure\Persistence\Doctrine\Entity\DoctrineEvent;
use Frontstage\Catalog\Infrastructure\Persistence\Doctrine\Entity\DoctrinePriceTier;
use Frontstage\Catalog\Infrastructure\Persistence\Doctrine\Entity\DoctrineSeat;

/**
 * Converts between the domain aggregate {@see Event} and the Doctrine
 * persistence model. Lives in the infrastructure layer; the domain has no
 * knowledge of it.
 */
final class EventMapper
{
	private const SEATING_SECTIONED = 'sectioned';
	private const SEATING_GA = 'general_admission';

	public function toDoctrine(Event $event, ?DoctrineEvent $existing = null): DoctrineEvent
	{
		$seating = $event->venue()->seating;

		if ($seating instanceof SectionedSeating) {
			$seatingType = self::SEATING_SECTIONED;
			$gaCapacity = null;
			$gaPriceTierId = null;
		} elseif ($seating instanceof GeneralAdmissionSeating) {
			$seatingType = self::SEATING_GA;
			$gaCapacity = $seating->capacity;
			$gaPriceTierId = $seating->priceTierId->value;
		} else {
			throw new InvalidArgument('Unknown seating definition type.');
		}

		if (null === $existing) {
			$doctrine = new DoctrineEvent(
				id: $event->id->toString(),
				title: $event->title()->value,
				description: $event->description()->value,
				startsAt: $event->startsAt()->value,
				status: $event->status()->value,
				venueName: $event->venue()->name->value,
				seatingType: $seatingType,
				gaCapacity: $gaCapacity,
				gaPriceTierId: $gaPriceTierId,
			);
		} else {
			$doctrine = $existing;
			$doctrine->title = $event->title()->value;
			$doctrine->description = $event->description()->value;
			$doctrine->startsAt = $event->startsAt()->value;
			$doctrine->status = $event->status()->value;
			$doctrine->venueName = $event->venue()->name->value;
			$doctrine->seatingType = $seatingType;
			$doctrine->gaCapacity = $gaCapacity;
			$doctrine->gaPriceTierId = $gaPriceTierId;
		}

		$this->syncPriceTiers($event, $doctrine);
		$this->syncSeats($event, $doctrine);

		return $doctrine;
	}

	public function toDomain(DoctrineEvent $row): Event
	{
		$priceTiers = [];
		foreach ($row->priceTiers as $tier) {
			$priceTiers[] = new PriceTier(
				PriceTierId::of($tier->tierId),
				PriceTierName::of($tier->name),
				Money::of($tier->priceAmount, Currency::of($tier->priceCurrency)),
			);
		}

		$seating = $this->buildSeating($row);

		return Event::reconstitute(
			EventId::fromString($row->id),
			EventTitle::of($row->title),
			EventDescription::of($row->description),
			StartsAt::fromDateTime($row->startsAt),
			new Venue(VenueName::of($row->venueName), $seating),
			$priceTiers,
			EventStatus::from($row->status),
		);
	}

	private function buildSeating(DoctrineEvent $row): SeatingDefinition
	{
		if (self::SEATING_GA === $row->seatingType) {
			if (null === $row->gaCapacity || null === $row->gaPriceTierId) {
				throw new InvalidArgument('General admission row missing capacity or price tier.');
			}

			return new GeneralAdmissionSeating(
				$row->gaCapacity,
				PriceTierId::of($row->gaPriceTierId),
			);
		}

		if (self::SEATING_SECTIONED !== $row->seatingType) {
			throw new InvalidArgument(sprintf('Unknown seating type "%s".', $row->seatingType));
		}

		// Group seats by (section -> row -> seats).
		$grouped = [];
		foreach ($row->seats as $seat) {
			$grouped[$seat->section][$seat->rowLabel][] = $seat;
		}

		$sections = [];
		foreach ($grouped as $sectionName => $rowGroups) {
			$rows = [];
			foreach ($rowGroups as $rowLabel => $seatRows) {
				$seats = [];
				foreach ($seatRows as $seat) {
					$seats[] = new Seat(
						SeatId::of($seat->section, $seat->rowLabel, $seat->seatNumber),
						PriceTierId::of($seat->priceTierId),
						SeatStatus::from($seat->status),
					);
				}
				$rows[] = new Row((string) $rowLabel, $seats);
			}
			$sections[] = new Section((string) $sectionName, $rows);
		}

		return new SectionedSeating($sections);
	}

	private function syncPriceTiers(Event $event, DoctrineEvent $doctrine): void
	{
		$existing = [];
		foreach ($doctrine->priceTiers as $row) {
			$existing[$row->tierId] = $row;
		}

		$seen = [];
		foreach ($event->priceTiers() as $tier) {
			$seen[$tier->id->value] = true;

			if (isset($existing[$tier->id->value])) {
				$row = $existing[$tier->id->value];
				$row->name = $tier->name->value;
				$row->priceAmount = $tier->price->amount;
				$row->priceCurrency = $tier->price->currency->code;
				continue;
			}

			$row = new DoctrinePriceTier(
				event: $doctrine,
				tierId: $tier->id->value,
				name: $tier->name->value,
				priceAmount: $tier->price->amount,
				priceCurrency: $tier->price->currency->code,
			);
			$doctrine->priceTiers->add($row);
		}

		foreach ($existing as $tierId => $row) {
			if (!isset($seen[$tierId])) {
				$doctrine->priceTiers->removeElement($row);
			}
		}
	}

	private function syncSeats(Event $event, DoctrineEvent $doctrine): void
	{
		// Index existing persistence seats by their composite identity.
		$existing = [];
		foreach ($doctrine->seats as $row) {
			$existing[$this->seatKey($row->section, $row->rowLabel, $row->seatNumber)] = $row;
		}

		$seen = [];
		foreach ($event->seats() as $seat) {
			$key = $this->seatKey($seat->id->section, $seat->id->row, $seat->id->number);
			$seen[$key] = true;

			if (isset($existing[$key])) {
				$row = $existing[$key];
				$row->priceTierId = $seat->priceTierId->value;
				$row->status = $seat->status()->value;
				continue;
			}

			$row = new DoctrineSeat(
				event: $doctrine,
				section: $seat->id->section,
				rowLabel: $seat->id->row,
				seatNumber: $seat->id->number,
				priceTierId: $seat->priceTierId->value,
				status: $seat->status()->value,
			);
			$doctrine->seats->add($row);
		}

		foreach ($existing as $key => $row) {
			if (!isset($seen[$key])) {
				$doctrine->seats->removeElement($row);
			}
		}
	}

	private function seatKey(string $section, string $row, string $number): string
	{
		return $section."\x1f".$row."\x1f".$number;
	}
}
