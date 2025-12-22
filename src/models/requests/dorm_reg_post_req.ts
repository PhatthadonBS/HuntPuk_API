export interface DormRegPostReq {
    owner_id:   number;
    name:       string;
    address:    string;
    lat:        number;
    lng:        number;
    zone_id:    number;
    type_id:    number;
    water_unit: number;
    water_lump: number;
    elect_unit: number;
    detail:     string;
    facilities: string;
    roomTypes:  string;
}
