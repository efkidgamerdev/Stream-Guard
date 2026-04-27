import { useQuery } from "@tanstack/react-query";

export const useUnseenChannelRequests = () => {
  return useQuery({
    queryKey: ["unseen-channel-requests"],
    queryFn: async () => {
      const res = await fetch("/api/channel-requests/unseen");
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });
};
